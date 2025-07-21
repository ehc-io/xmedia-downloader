#!/usr/bin/env python3
"""
xmedia-downloader.py

This script serves as the main entry point for downloading media from a given
Twitter/X URL. It is designed to be run within a Docker container and is configured
via environment variables and command-line arguments.

It orchestrates several modules to handle:
1. Session management: Validating and refreshing the user session.
2. Content extraction: Scraping basic tweet metadata for filenames.
3. API communication: Fetching detailed tweet data to find media URLs.
4. Media downloading: Saving the media files to a specified directory.
"""
import argparse
import logging
import os
import sys
from pathlib import Path

# --- Import Core Components ---
from twitter_session_manager import TwitterSessionManager
from twitter_content_extractor import TweetExtractor
from twitter_api_client import TwitterAPIClient
from twitter_media_downloader import TwitterMediaDownloader

# --- Basic Configuration ---
# Configure logging based on verbosity argument.
logger = logging.getLogger(__name__)


def main():
    """Main execution function."""
    parser = argparse.ArgumentParser(
        description="Download all media (images/videos) from a single Tweet/X URL.",
        epilog="This script is intended to be run inside a Docker container. "
               "It requires X_USERNAME and X_PASSWORD environment variables for session management."
    )
    parser.add_argument(
        "-u", "--url",
        required=True,
        help="The full URL of the tweet (e.g., 'https://x.com/user/status/12345')."
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose logging for debugging purposes."
    )
    args = parser.parse_args()

    # --- Configure Logging ---
    log_level = logging.DEBUG if args.verbose else logging.INFO
    log_format = '%(asctime)s - %(levelname)s - %(name)s - %(message)s'
    logging.basicConfig(level=log_level, format=log_format, stream=sys.stdout)

    # --- Read Configuration from Environment Variables ---
    # These are set in the Dockerfile or via `docker run -e ...`
    output_dir = os.getenv('OUTPUT_DIR', './downloads')
    session_dir = os.getenv('SESSION_DIR', './session-data')

    logger.info(f"Using output directory: {output_dir}")
    logger.info(f"Using session directory: {session_dir}")
    
    # --- Main Application Logic ---
    try:
        # 1. Ensure a valid session exists before proceeding
        logger.info("--- Step 1: Validating Session ---")
        session_manager = TwitterSessionManager(session_dir=session_dir)
        if not session_manager.ensure_valid_session():
            logger.critical("Could not establish a valid session. Exiting.")
            print("\n❌ Failure: Could not establish a valid session. Check credentials and logs.", file=sys.stderr)
            sys.exit(1)
        logger.info("Session is valid.")

        # 2. Extract Tweet ID from URL
        tweet_id = TweetExtractor.extract_tweet_id_from_url(args.url)
        if not tweet_id:
            logger.critical(f"Could not extract Tweet ID from URL: {args.url}. Exiting.")
            print(f"\n❌ Failure: Invalid Tweet URL provided: {args.url}", file=sys.stderr)
            sys.exit(1)

        # 3. Get Tweet Metadata (for filename generation)
        # We use the playwright-based extractor to get the user handle and timestamp.
        # This is more reliable than trying to get it from the API response alone.
        logger.info("--- Step 2: Extracting Tweet Metadata ---")
        content_extractor = TweetExtractor(session_path=str(session_manager.get_session_path()))
        tweet_details = content_extractor.extract_tweet(args.url)
        if tweet_details.get('error'):
            raise RuntimeError(f"Failed to extract tweet content via Playwright: {tweet_details['error']}")
        
        # The downloader expects timestamp in milliseconds
        tweet_details['timestamp_ms'] = tweet_details.get('timestamp', 0) * 1000
        logger.info(f"Extracted metadata for user: @{tweet_details.get('user_handle')}")

        # 4. Fetch Media URLs from the API
        logger.info("--- Step 3: Fetching Media URLs via API ---")
        api_client = TwitterAPIClient(session_path=session_manager.get_session_path())
        api_data = api_client.fetch_tweet_data_api(tweet_id)
        if not api_data:
            raise RuntimeError("Failed to fetch tweet data from API. The tweet might be protected, deleted, or the API endpoint may have changed.")

        media_items_to_download = api_client.extract_media_urls_from_api_data(api_data)

        # 5. Download Media Files
        if media_items_to_download:
            logger.info(f"--- Step 4: Downloading {len(media_items_to_download)} Media Item(s) ---")
            downloader = TwitterMediaDownloader(output_dir=output_dir)
            downloaded_files = downloader.download_media_items(
                media_items=media_items_to_download,
                tweet_details=tweet_details,
                tweet_id=tweet_id
            )
            
            if downloaded_files:
                print(f"\n✅ Success: Downloaded {len(downloaded_files)} media file(s) to '{output_dir}'.")
            else:
                print(f"\n❌ Failure: Found {len(media_items_to_download)} media items but could not download any. Check logs for errors.")
        else:
            print("\n✅ Success: No media items were found for the given URL.")

    except Exception as e:
        logger.critical(f"An unexpected error occurred: {e}", exc_info=args.verbose)
        print(f"\n❌ An unexpected error occurred: {e}", file=sys.stderr)
        if not args.verbose:
            print("Run with the --verbose flag for more details.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main() 