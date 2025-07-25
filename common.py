import os
import re
from typing import List
from datetime import datetime

# litellm._turn_on_debug() # Keep commented unless debugging litellm

import logging # Ensure logging is configured if not already
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
# Suppress LiteLLM INFO logs
logging.getLogger("LiteLLM").setLevel(logging.WARNING)
def clean_filename(filename):
    """
    Clean a filename by:
    1) Converting to lowercase
    2) Replacing special characters and spaces with underscores
    3) Removing multiple consecutive underscores
    """
    # Get the base name and extension separately
    base_name, extension = os.path.splitext(filename)
    
    # Step 1: Convert to lowercase
    base_name = base_name.lower()
    extension = extension.lower()
    
    # Step 2: Replace special characters and spaces with underscores
    # This regex matches any character that is not alphanumeric or underscore
    base_name = re.sub(r'[^a-z0-9_]', '_', base_name)
    
    # Step 3: Replace multiple consecutive underscores with a single underscore
    base_name = re.sub(r'_{2,}', '_', base_name)
    
    # Remove leading and trailing underscores
    base_name = base_name.strip('_')
    
    # Return the cleaned filename with extension
    return base_name + extension
    
