#!/usr/bin/env python3
# twitter_session_manager.py
import subprocess
import json
import os
import logging
from pathlib import Path
from datetime import datetime
from playwright.sync_api import sync_playwright, Error as PlaywrightError
from gcs_client import GCSClient
from common import get_playwright_proxy_config

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class TwitterSessionManager:
    """Manages Twitter authentication session validation and refresh."""

    def __init__(self, session_dir_name="session-data", session_file_name="x-session.json"):
        # Use /tmp for local session file storage (writable by all users)
        self.session_dir = Path("/tmp") / session_dir_name
        self.session_path = self.session_dir / session_file_name
        
        # Ensure local session directory exists
        self.session_dir.mkdir(parents=True, exist_ok=True)
        
        self.gcs_client = GCSClient()
        # Define the full GCS blob path
        self.gcs_session_blob_name = f"{session_dir_name}/{session_file_name}"

    def get_session_path(self) -> Path:
        """Return the full path to the session file."""
        return self.session_path

    def _take_screenshot(self, page, filename: str) -> None:
        """
        Takes a screenshot and uploads it to GCS for debugging purposes.
        Similar to the Node.js script's takeScreenshot function.
        """
        try:
            # Create timestamp for filename
            timestamp = datetime.utcnow().isoformat().replace(':', '-').replace('.', '-')
            screenshot_filename = f"{timestamp}-{filename}.png"
            
            # Take screenshot to temporary file
            temp_screenshot_path = Path("/tmp") / screenshot_filename
            page.screenshot(path=str(temp_screenshot_path), full_page=True)
            
            # Upload to GCS
            destination = f"screenshots/{screenshot_filename}"
            self.gcs_client.upload_file(str(temp_screenshot_path), destination)
            logger.info(f"Screenshot uploaded to gs://{self.gcs_client.bucket_name}/{destination}")
            
            # Clean up temporary file
            temp_screenshot_path.unlink()
            
        except Exception as error:
            logger.error(f"Failed to take or upload screenshot: {error}")

    def _run_refresh_script(self) -> bool:
        """
        Executes the Node.js script to refresh the Twitter session.
        The Node.js script is responsible for uploading the new session to GCS.
        Returns True if successful, False otherwise.
        """
        script_path = Path("/app/refresh_twitter_session.js")
        if not script_path.exists():
            logger.error(f"Refresh script not found at {script_path}")
            return False

        if 'X_USERNAME' not in os.environ or 'X_PASSWORD' not in os.environ:
            logger.error("X_USERNAME and X_PASSWORD environment variables must be set to refresh session.")
            return False

        try:
            logger.info("Attempting to refresh user session via Node.js script...")
            
            result = subprocess.run(
                ["node", str(script_path)],
                capture_output=True,
                text=True,
                check=False, # Don't throw error on non-zero exit code, handle manually
                cwd=Path("/app") # Run script from app directory
            )

            logger.debug(f"Refresh script stdout: {result.stdout}")
            logger.debug(f"Refresh script stderr: {result.stderr}")

            if result.returncode != 0:
                logger.error(f"Failed to refresh session. Node script exited with code {result.returncode}.")
                logger.error(f"Stderr: {result.stderr}")
                return False
            
            # The Node.js script handles the GCS upload. No local file check or upload is needed here.
            logger.info("Session data refreshed and uploaded to GCS successfully by Node.js script.")
            return True
        except FileNotFoundError:
             logger.error("Error: 'node' command not found. Please ensure Node.js is installed and in your PATH.")
             return False
        except Exception as e:
            logger.error(f"Error running refresh script: {e}")
            return False

    def _is_session_valid_playwright(self) -> bool:
        """Checks if the session stored in the file is currently valid using Playwright."""
        # First, try to use local session file if it exists
        if not self.session_path.exists():
            logger.info("Local session file does not exist, checking GCS...")
            logger.info(f"[GCS ACCESS] About to check GCS bucket '{self.gcs_client.bucket_name}' for session file")
            logger.info(f"[GCS ACCESS] Session blob path: {self.gcs_session_blob_name}")
            
            # Try to download from GCS
            if not self.gcs_client.blob_exists(self.gcs_session_blob_name):
                logger.info("[GCS ACCESS] Session file does not exist in GCS either.")
                return False
            
            try:
                logger.info(f"[GCS ACCESS] Session file found in GCS, downloading to local path: '{self.session_path}'")
                self.gcs_client.download_file(self.gcs_session_blob_name, str(self.session_path))
                logger.info(f"[GCS ACCESS] Successfully downloaded session file from GCS")
            except Exception as e:
                logger.error(f"[GCS ACCESS] Failed to download session file from GCS: {e}")
                return False

        logger.info("Verifying session validity using Playwright...")
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(
                    headless=True,
                    proxy=get_playwright_proxy_config()
                )
                try:
                    context = browser.new_context(storage_state=str(self.session_path))
                    page = context.new_page()
                    try:
                         # Navigate to a page that requires login
                        network_timeout = int(os.environ.get('NETWORK_TIMEOUT', 30000))
                        page.goto("https://x.com/home", timeout=network_timeout, wait_until='domcontentloaded')
                        
                        interaction_timeout = int(os.environ.get('INTERACTION_TIMEOUT', 5000))
                        page.wait_for_timeout(interaction_timeout) # Allow redirect/rendering

                        # Check for a reliable indicator of being logged in
                        compose_button_selector = 'a[data-testid="SideNav_NewTweet_Button"]'
                        is_logged_in = page.query_selector(compose_button_selector) is not None

                        if is_logged_in:
                            logger.info("Playwright check: Session appears valid.")
                            # Take screenshot of valid session for verification
                            self._take_screenshot(page, 'session-validation-success')
                        else:
                            logger.warning(f"Playwright check: Session appears invalid (login indicator not found on x.com/home). Title: {page.title()}")
                            # Take screenshot of invalid session for troubleshooting
                            self._take_screenshot(page, 'session-validation-failed')

                        page.close()
                        context.close()
                        return is_logged_in

                    except PlaywrightError as e:
                         logger.error(f"Playwright error during session validation check: {e}")
                         # Take screenshot on Playwright error for debugging
                         try:
                             self._take_screenshot(page, 'session-validation-playwright-error')
                             logger.info('Screenshot taken due to Playwright error during session validation.')
                         except Exception as screenshot_error:
                             logger.error(f'Failed to take Playwright error screenshot: {screenshot_error}')
                         # Attempt to close gracefully
                         try: page.close()
                         except: pass
                         try: context.close()
                         except: pass
                         return False # Treat playwright errors as invalid session
                finally:
                    browser.close()

        except Exception as e:
            logger.error(f"Unexpected error during Playwright session validation: {e}")
            # Take screenshot on unexpected error for debugging
            try:
                if 'page' in locals():
                    self._take_screenshot(page, 'session-validation-unexpected-error')
                    logger.info('Screenshot taken due to unexpected error during session validation.')
            except Exception as screenshot_error:
                logger.error(f'Failed to take unexpected error screenshot: {screenshot_error}')
            return False # Treat other errors as invalid

    def ensure_valid_session(self) -> bool:
        """
        Ensures a valid session exists. Checks current session, refreshes if invalid or missing.
        Returns True if a valid session is confirmed or established, False otherwise.
        """
        logger.info("Ensuring valid Twitter/X session...")
        if self._is_session_valid_playwright():
            logger.info("Current session is valid.")
            return True
        else:
            logger.warning("Current session is invalid or missing. Attempting refresh.")
            if self._run_refresh_script():
                logger.info("Session refreshed. Re-validating...")
                # Re-validate after refresh for confirmation
                if self._is_session_valid_playwright():
                     logger.info("Refreshed session confirmed as valid.")
                     return True
                else:
                     logger.error("Session was refreshed, but still fails validation check.")
                     return False
            else:
                logger.error("Session refresh failed.")
                return False
