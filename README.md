
# X Media Downloader

X Media Downloader is a tool for downloading videos and images from individual Twitter/X posts. It is designed to be run in a Docker container, providing a seamless and isolated environment for all its operations.

## Features

- **Media Downloading**: Downloads all images and videos from a single tweet URL.
- **Session Management**: Automatically handles login sessions, refreshing them when they expire.
- **Descriptive Filenames**: Saves media with structured filenames, including the date, time, and username (e.g., `20231027_153000_username_tweetid_1.mp4`).
- **Dockerized**: Runs entirely within a Docker container, simplifying dependency management and ensuring consistent behavior.

## Prerequisites

- [Docker](https://www.docker.com/get-started) installed and running.
- A Twitter/X account.

## How to Run

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/your-username/xmedia-downloader.git
    cd xmedia-downloader
    ```

2.  **Build the Docker Image**:
    ```bash
    docker build -t xmedia-downloader .
    ```

3.  **Run the Downloader**:
    Execute the following command, replacing the placeholder values:
    ```bash
    docker run --rm -it \
      -e X_USERNAME="your_x_username" \
      -e X_PASSWORD="your_x_password" \
      -v "$(pwd)/downloads:/app/downloads" \
      xmedia-downloader \
      -u "https://x.com/someuser/status/1234567890"
    ```

    - `-e X_USERNAME`: Your Twitter/X username.
    - `-e X_PASSWORD`: Your Twitter/X password.
    - `-v "$(pwd)/downloads:/app/downloads"`: Mounts the local `downloads` folder to the container, so your files are saved to your machine.
    - `-u`: The full URL of the tweet you want to download media from.

## How It Works

The tool orchestrates several components:
- **Session Manager**: Logs into X and maintains a valid session.
- **Content Extractor**: Scrapes the tweet page to get metadata for filenames.
- **API Client**: Uses the authenticated session to call Twitter's internal API and find media URLs.
- **Downloader**: Downloads the media and saves it to the `downloads` directory.
