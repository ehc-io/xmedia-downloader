#!/bin/sh
set -e

# Check the first argument provided to the container
if [ "$1" = "refresh-session" ]; then
    # If the argument is "refresh-session", execute the Node.js script
    # to refresh the Twitter/X session.
    echo "Executing command: Force session refresh..."
    node ./refresh_twitter_session.js
else
    # Otherwise, execute the main Python application, passing all arguments
    # to it. This is the default behavior for downloading media.
    echo "Executing command: Run X-Media Downloader..."
    exec python3 xmedia_downloader.py "$@"
fi 