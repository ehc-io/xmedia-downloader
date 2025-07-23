import logging
import os
from google.cloud import storage

class GCSClient:
    def __init__(self):
        self.bucket_name = os.environ.get("GCS_BUCKET_NAME")
        if not self.bucket_name:
            raise ValueError("GCS_BUCKET_NAME environment variable not set")
        self.storage_client = storage.Client()
        self.bucket = self.storage_client.bucket(self.bucket_name)

    def upload_file(self, source_file_name, destination_blob_name):
        """Uploads a file to the bucket."""
        blob = self.bucket.blob(destination_blob_name)
        blob.upload_from_filename(source_file_name)
        logging.info(
            f"File {source_file_name} uploaded to {destination_blob_name}."
        )

    def download_file(self, source_blob_name, destination_file_name):
        """Downloads a file from the bucket."""
        logging.info(f"[GCS READ] Attempting to download file from GCS bucket: {self.bucket_name}")
        logging.info(f"[GCS READ] Source blob: {source_blob_name} -> Destination: {destination_file_name}")
        
        try:
            blob = self.bucket.blob(source_blob_name)
            blob.download_to_filename(destination_file_name)
            
            # Get file size for logging
            try:
                file_size = os.path.getsize(destination_file_name)
                logging.info(f"[GCS READ] Successfully downloaded {source_blob_name} ({file_size} bytes)")
            except OSError:
                logging.info(f"[GCS READ] Successfully downloaded {source_blob_name}")
            
            logging.info(f"File {source_blob_name} downloaded to {destination_file_name}.")
        except Exception as e:
            logging.error(f"[GCS READ] Failed to download file from GCS - Bucket: {self.bucket_name}, Blob: {source_blob_name}")
            logging.error(f"[GCS READ] Download error: {e}")
            raise

    def get_file_as_string(self, blob_name):
        """Downloads a blob from the bucket and returns it as a string."""
        logging.info(f"[GCS READ] Attempting to download blob as string from GCS bucket: {self.bucket_name}")
        logging.info(f"[GCS READ] Target blob: {blob_name}")
        
        try:
            blob = self.bucket.blob(blob_name)
            content = blob.download_as_text()
            content_length = len(content)
            logging.info(f"[GCS READ] Successfully downloaded blob as string: {blob_name} ({content_length} characters)")
            return content
        except Exception as e:
            logging.error(f"[GCS READ] Failed to download blob as string - Bucket: {self.bucket_name}, Blob: {blob_name}")
            logging.error(f"[GCS READ] Download error: {e}")
            raise

    def upload_file_from_string(self, data, destination_blob_name):
        """Uploads a string to the bucket."""
        blob = self.bucket.blob(destination_blob_name)
        blob.upload_from_string(data)
        logging.info(
            f"String data uploaded to {destination_blob_name}."
        )

    def blob_exists(self, blob_name):
        """Checks if a blob exists in the bucket."""
        logging.info(f"[GCS READ] Checking if blob exists in GCS bucket: {self.bucket_name}")
        logging.info(f"[GCS READ] Target blob: {blob_name}")
        
        try:
            blob = self.bucket.blob(blob_name)
            exists = blob.exists()
            logging.info(f"[GCS READ] Blob existence check result: {exists} for {blob_name}")
            return exists
        except Exception as e:
            logging.error(f"[GCS READ] Failed to check blob existence - Bucket: {self.bucket_name}, Blob: {blob_name}")
            logging.error(f"[GCS READ] Existence check error: {e}")
            raise 