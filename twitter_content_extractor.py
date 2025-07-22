#!/usr/bin/env python3
import logging
import re
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright, Page, BrowserContext, Error as PlaywrightError
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class TweetExtractor:
    """
    Uses Playwright to navigate to a tweet and extract basic metadata
    like user handle and timestamp for filename generation.
    """
    def __init__(self, session_path: str):
        self.session_path = Path(session_path)
        if not self.session_path.is_file():
            # Correctly handle the case where session_path is a string representation of a Path
            self.session_path = Path(str(session_path))
            if not self.session_path.is_file():
                 raise FileNotFoundError(f"Session file not found at '{self.session_path}'")

    def extract_tweet(self, tweet_url: str) -> Dict[str, Any]:
        """
        Extracts metadata from a single tweet page.

        Args:
            tweet_url (str): The full URL of the tweet.

        Returns:
            Dict[str, Any]: A dictionary with tweet metadata or an error.
        """
        logger.info(f"Navigating to {tweet_url} to extract content...")
        
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(storage_state=str(self.session_path))
                page = context.new_page()

                try:
                    # Use a more robust navigation strategy
                    # 'domcontentloaded' is often faster and sufficient
                    page.goto(tweet_url, wait_until="domcontentloaded", timeout=30000)

                    # Wait for the main tweet container to be visible
                    # This is a more reliable indicator that the content has loaded
                    tweet_article_selector = 'article[data-testid="tweet"]'
                    tweet_article = page.wait_for_selector(tweet_article_selector, timeout=20000, state='visible')
                    
                    if not tweet_article:
                        return {"error": "Could not find the main tweet element on the page."}

                    # Extract user handle
                    # This selector targets the element containing the '@handle'
                    user_handle_selector = 'div[data-testid="User-Name"] a > div > span'
                    user_handle_element = tweet_article.query_selector(user_handle_selector)
                    user_handle = user_handle_element.inner_text().replace("@", "").strip() if user_handle_element else 'unknown_user'

                    # Extract timestamp from the <time> element's datetime attribute
                    time_element = tweet_article.query_selector("time")
                    timestamp_str = time_element.get_attribute("datetime") if time_element else ""
                    
                    timestamp_unix = 0
                    if timestamp_str:
                        # Parse ISO 8601 format (e.g., "2023-01-01T12:00:00.000Z")
                        # Use replace("Z", "+00:00") for compatibility with fromisoformat
                        dt_object = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
                        timestamp_unix = int(dt_object.timestamp())

                    details = {
                        "user_handle": user_handle,
                        "timestamp": timestamp_unix, # Unix timestamp in seconds
                        "tweet_url": tweet_url,
                        "error": None
                    }
                    
                    logger.info(f"Successfully extracted metadata: User @{user_handle}, Timestamp {timestamp_unix}")
                    return details

                except PlaywrightError as e:
                    logger.error(f"A Playwright error occurred during tweet extraction: {e}")
                    return {"error": str(e)}
                finally:
                    page.close()
                    context.close()
                    browser.close()

        except Exception as e:
            logger.error(f"An unexpected error occurred in TweetExtractor: {e}", exc_info=True)
            return {"error": str(e)}

    @staticmethod
    def is_valid_twitter_url(url: str) -> bool:
        """
        Validates if the given URL is a plausible Twitter/X post URL.
        It checks for the domain and the general structure of a status URL.
        """
        # A simple but effective regex to match common Twitter/X post URLs.
        # It allows for http/https, www optional, and handles both x.com and twitter.com
        pattern = re.compile(
            r'^(https?://)?(www\.)?(twitter|x)\.com/[a-zA-Z0-9_]+/status/\d+(\?.*)?$'
        )
        is_match = bool(pattern.match(url))
        if not is_match:
            logger.warning(f"Validation failed for URL: {url}")
        return is_match

    @staticmethod
    def extract_tweet_id_from_url(url: str) -> Optional[str]:
        """
        Extracts the tweet ID from a Twitter/X URL using a robust regular expression.
        Handles various URL formats including those with query parameters.
        """
        # This regex looks for 'status/' or 'statuses/' followed by a sequence of digits
        match = re.search(r'/(?:status|statuses)/(\d+)', url)
        if match:
            tweet_id = match.group(1)
            logger.info(f"Extracted Tweet ID: {tweet_id}")
            return tweet_id
        
        logger.error(f"Could not extract Tweet ID from URL: {url}")
        return None