#!/usr/bin/env python3
"""
xmedia-downloader.py

This script serves as the main entry point for downloading media from a given
Twitter/X URL. It is designed to be run within a Docker container and is configured
via environment variables.

It runs as a web service that listens for POST requests containing the URL to be processed.
"""
import logging
import os
import sys
import threading
from pathlib import Path
from flask import Flask, request, jsonify

# --- Configure Logging FIRST (before importing other modules) ---
log_level = logging.INFO
if os.getenv('LOG_LEVEL', 'INFO').upper() == 'DEBUG':
    log_level = logging.DEBUG
log_format = '%(asctime)s - %(levelname)s - %(name)s - %(message)s'
logging.basicConfig(level=log_level, format=log_format, stream=sys.stdout, force=True)

# Set all loggers to use the same level
logging.getLogger().setLevel(log_level)
for logger_name in ['twitter_session_manager', 'twitter_content_extractor', 'twitter_api_client', 'twitter_media_downloader']:
    logging.getLogger(logger_name).setLevel(log_level)


class HealthCheckFilter(logging.Filter):
    """Filter to exclude health check requests from logs."""
    def filter(self, record):
        # Filter out GET requests to /health endpoint
        if hasattr(record, 'getMessage'):
            message = record.getMessage()
            if 'GET /health' in message and '200' in message:
                return False
        return True


# Apply the filter to werkzeug logger (handles Flask request logging)
werkzeug_logger = logging.getLogger('werkzeug')
werkzeug_logger.addFilter(HealthCheckFilter())

logger = logging.getLogger(__name__)

# --- Import Core Components (after logging setup) ---
from twitter_session_manager import TwitterSessionManager
from twitter_content_extractor import TweetExtractor
from twitter_api_client import TwitterAPIClient
from twitter_media_downloader import TwitterMediaDownloader

# --- Flask App Initialization ---
app = Flask(__name__)

# --- Read Configuration from Environment Variables ---
# These are set in the Dockerfile or via `docker run -e ...`

# Global session manager instance
session_manager = None


def get_session_manager():
    """Get or create the global session manager instance."""
    global session_manager
    if session_manager is None:
        session_manager = TwitterSessionManager()
    return session_manager


def process_tweet_download(url: str):
    """
    Processes a single tweet URL to download its media.
    This function is designed to be run in a background thread.
    """
    try:
        logger.info(f"--- Starting Download Process for URL: {url} ---")
        
        # 1. Ensure a valid session exists before proceeding
        logger.info("--- Step 1: Validating Session ---")
        sm = get_session_manager()
        if not sm.ensure_valid_session():
            logger.critical("Could not establish a valid session. Aborting this download.")
            return
        logger.info("Session is valid.")

        # 2. Extract Tweet ID from URL
        tweet_id = TweetExtractor.extract_tweet_id_from_url(url)
        if not tweet_id:
            logger.critical(f"Could not extract Tweet ID from URL: {url}. Aborting.")
            return
        logger.debug(f"Extracted Tweet ID: {tweet_id}")

        # 3. Get Tweet Metadata (for filename generation)
        logger.info("--- Step 2: Extracting Tweet Metadata ---")
        content_extractor = TweetExtractor(session_path=str(sm.get_session_path()))
        tweet_details = content_extractor.extract_tweet(url)
        if tweet_details.get('error'):
            logger.error(f"Failed to extract tweet content via Playwright: {tweet_details['error']}")
            return
        
        # The downloader expects timestamp in milliseconds
        tweet_details['timestamp_ms'] = tweet_details.get('timestamp', 0) * 1000
        logger.info(f"Extracted metadata for user: @{tweet_details.get('user_handle')}")
        logger.debug(f"Tweet details: {tweet_details}")

        # 4. Fetch Media URLs from the API
        logger.info("--- Step 3: Fetching Media URLs via API ---")
        api_client = TwitterAPIClient(session_path=sm.get_session_path())
        api_data = api_client.fetch_tweet_data_api(tweet_id)
        if not api_data:
            logger.error("Failed to fetch tweet data from API. The tweet might be protected, deleted, or the API endpoint may have changed.")
            return

        media_items_to_download = api_client.extract_media_urls_from_api_data(api_data)
        logger.debug(f"Found {len(media_items_to_download)} media items to download")

        # 5. Download Media Files
        if media_items_to_download:
            logger.info(f"--- Step 4: Downloading {len(media_items_to_download)} Media Item(s) ---")
            downloader = TwitterMediaDownloader()
            downloaded_files = downloader.download_media_items(
                media_items=media_items_to_download,
                tweet_details=tweet_details,
                tweet_id=tweet_id
            )
            
            if downloaded_files:
                logger.info(f"✅ Success: Downloaded {len(downloaded_files)} media file(s) to GCS.")
                logger.debug(f"Downloaded files: {downloaded_files}")
            else:
                logger.warning(f"Found {len(media_items_to_download)} media items but could not download any. Check logs for errors.")
        else:
            logger.info("✅ Success: No media items were found for the given URL.")

    except Exception as e:
        logger.critical(f"An unexpected error occurred while processing {url}: {e}", exc_info=True)


@app.route('/extract-media', methods=['POST'])
def extract_media():
    """API endpoint to trigger a tweet media download."""
    data = request.get_json()
    if not data or 'url' not in data:
        logger.warning("Invalid request received: missing 'url' field")
        return jsonify({"error": "Invalid request. 'url' is required."}), 400

    url = data['url']
    logger.debug(f"Received extract-media request for URL: {url}")
    
    if not TweetExtractor.is_valid_twitter_url(url):
        logger.warning(f"Invalid Twitter URL received: {url}")
        return jsonify({"error": f"Invalid Twitter/X post URL: {url}"}), 400

    # Run the download process in a background thread
    download_thread = threading.Thread(target=process_tweet_download, args=(url,))
    download_thread.start()

    logger.info(f"Request for URL '{url}' received and queued for processing.")
    return jsonify({"message": "Request received. Media download process started."}), 202


def process_session_refresh():
    """
    Processes session refresh by forcing a new login.
    This function is designed to be run in a background thread.
    """
    try:
        logger.info("--- Starting Forced Session Refresh Process ---")
        sm = get_session_manager()
        
        # Delete existing session file to force a fresh login
        session_path = sm.get_session_path()
        if session_path.exists():
            logger.info(f"Removing existing session file: {session_path}")
            session_path.unlink()
            logger.debug("Existing session file deleted")
        else:
            logger.debug("No existing session file found")
        
        # Force refresh by calling the refresh script directly
        logger.info("--- Running refresh script to create new session ---")
        if sm._run_refresh_script():
            # Validate the new session
            if sm._is_session_valid_playwright():
                logger.info("✅ Session refresh completed and validated successfully")
            else:
                logger.error("❌ Session was refreshed but validation failed")
        else:
            logger.error("❌ Session refresh script failed")
            
    except Exception as e:
        logger.critical(f"An unexpected error occurred during session refresh: {e}", exc_info=True)


@app.route('/refresh-session', methods=['GET'])
def refresh_session():
    """API endpoint to trigger an asynchronous session refresh."""
    try:
        logger.info("Manual session refresh requested")
        
        # Run the refresh process in a background thread
        refresh_thread = threading.Thread(target=process_session_refresh)
        refresh_thread.start()
        
        logger.info("Session refresh process started in background")
        return jsonify({"message": "Session refresh request received. Process started in background."}), 202
        
    except Exception as e:
        logger.error(f"Error starting session refresh: {e}", exc_info=True)
        return jsonify({"error": f"Failed to start session refresh: {str(e)}"}), 500


@app.route('/health', methods=['GET'])
def health_check():
    """API endpoint for service health checking."""
    return jsonify({"status": "healthy"}), 200


@app.route('/session-status', methods=['GET'])
def session_status():
    """API endpoint to check current session status."""
    try:
        logger.debug("Session status check requested")
        sm = get_session_manager()
        
        # Check if session file exists
        session_exists = sm.get_session_path().exists()
        
        # Check if session is valid (only if it exists)
        session_valid = False
        if session_exists:
            session_valid = sm._is_session_valid_playwright()
        
        status = {
            "session_file_exists": session_exists,
            "session_valid": session_valid,
            "session_path": str(sm.get_session_path())
        }
        
        logger.debug(f"Session status: {status}")
        return jsonify(status), 200
        
    except Exception as e:
        logger.error(f"Error checking session status: {e}", exc_info=True)
        return jsonify({"error": f"Session status check error: {str(e)}"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    debug_mode = os.getenv('LOG_LEVEL', 'INFO').upper() == 'DEBUG'
    
    logger.info(f"Starting web server on port {port}")
    if debug_mode:
        logger.debug("Debug logging is enabled")
        logger.debug("Flask debug mode is enabled")
    
    app.run(host='0.0.0.0', port=port, debug=debug_mode) 