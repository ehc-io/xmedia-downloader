#!/usr/bin/env python3
import logging
import re
from datetime import datetime
from pathlib import Path

import requests
from tqdm import tqdm

# --- Logger Setup ---
logger = logging.getLogger(__name__)


class TwitterMediaDownloader:
    """
    Handles the downloading of media items (images and videos) and saves them
    to a specified directory with descriptive filenames.
    """
    def __init__(self, output_dir: str):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.session = requests.Session()
        # Use a common browser user agent
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        })

    def _generate_filename(self, tweet_details: dict, tweet_id: str, media_url: str, index: int) -> str:
        """
        Generates a structured filename based on tweet metadata.
        Format: YYYYMMDD_HHMMSS_<user_handle>_<tweet_id>_<index>.<extension>
        """
        user_handle = tweet_details.get('user_handle', 'unknown_user')
        # Use timestamp from tweet details (more accurate)
        timestamp = tweet_details.get('timestamp_ms', 0) / 1000
        
        dt_object = datetime.fromtimestamp(timestamp)
        date_str = dt_object.strftime("%Y%m%d_%H%M%S")
        
        # Extract file extension from URL
        file_extension = Path(media_url).suffix.split('?')[0]
        if not file_extension:
            # Fallback for URLs without extensions (e.g., video URLs)
            file_extension = ".mp4" if "video" in media_url else ".jpg"
            
        return f"{date_str}_{user_handle}_{tweet_id}_{index + 1}{file_extension}"

    def download_media_items(self, media_items: list, tweet_details: dict, tweet_id: str) -> list:
        """
        Downloads a list of media items.

        Args:
            media_items: A list of dictionaries, each with a 'url' and 'type'.
            tweet_details: A dictionary with metadata like user handle and timestamp.
            tweet_id: The ID of the tweet.

        Returns:
            A list of paths to the downloaded files.
        """
        downloaded_files = []
        for i, item in enumerate(media_items):
            url = item['url']
            filename = self._generate_filename(tweet_details, tweet_id, url, i)
            save_path = self.output_dir / filename
            
            logger.info(f"Downloading {item['type']} from {url} to {save_path}")
            
            try:
                response = self.session.get(url, stream=True, timeout=30)
                response.raise_for_status()

                total_size = int(response.headers.get('content-length', 0))

                with open(save_path, 'wb') as f, tqdm(
                    desc=filename,
                    total=total_size,
                    unit='iB',
                    unit_scale=True,
                    unit_divisor=1024,
                ) as bar:
                    for chunk in response.iter_content(chunk_size=8192):
                        size = f.write(chunk)
                        bar.update(size)
                
                downloaded_files.append(save_path)
                logger.info(f"Successfully downloaded {save_path}")
            except requests.exceptions.RequestException as e:
                logger.error(f"Failed to download {url}: {e}")
            except Exception as e:
                logger.error(f"An unexpected error occurred while downloading {url}: {e}")

        return downloaded_files