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
        blob = self.bucket.blob(source_blob_name)
        blob.download_to_filename(destination_file_name)
        logging.info(
            f"File {source_blob_name} downloaded to {destination_file_name}."
        )

    def get_file_as_string(self, blob_name):
        """Downloads a blob from the bucket and returns it as a string."""
        blob = self.bucket.blob(blob_name)
        return blob.download_as_text()

    def upload_file_from_string(self, data, destination_blob_name):
        """Uploads a string to the bucket."""
        blob = self.bucket.blob(destination_blob_name)
        blob.upload_from_string(data)
        logging.info(
            f"String data uploaded to {destination_blob_name}."
        )

    def blob_exists(self, blob_name):
        """Checks if a blob exists in the bucket."""
        blob = self.bucket.blob(blob_name)
        return blob.exists() 