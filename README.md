
# X Media Downloader

X Media Downloader is a web service for downloading videos and images from individual Twitter/X posts. It runs as a REST API server in a Docker container, providing asynchronous media extraction capabilities.

## Features

- **Web API Service**: REST API with multiple endpoints for media extraction and session management
- **Asynchronous Processing**: Non-blocking media downloads - immediate response with background processing
- **Media Downloading**: Downloads all images and videos from Twitter/X post URLs
- **Session Management**: Automatic login session handling with manual refresh capabilities
- **URL Validation**: Validates Twitter/X URLs before processing
- **Descriptive Filenames**: Saves media with structured filenames including date, time, and username
- **Debug Logging**: Configurable logging levels for troubleshooting
- **Dockerized**: Runs entirely within a Docker container with persistent data volumes

## Prerequisites

- [Docker](https://www.docker.com/get-started) installed and running
- A Twitter/X account with username and password

## Quick Start

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/your-username/xmedia-downloader.git
   cd xmedia-downloader
   ```

2. **Build the Docker Image**:
   ```bash
   docker build -t xmedia-downloader .
   ```

3. **Run the Web Service**:
   ```bash
   docker run -d \
     --name xmedia-downloader \
     -p 8080:8080 \
     -v "$(pwd)/downloads:/app/downloads" \
     -v "$(pwd)/session-data:/app/session-data" \
     -v "$(pwd)/screenshots:/app/screenshots" \
     -e X_USERNAME="your_twitter_username" \
     -e X_PASSWORD="your_twitter_password" \
     xmedia-downloader
   ```

## API Endpoints

### 1. Extract Media
**`POST /extract-media`**

Downloads media from a Twitter/X post URL asynchronously.

**Request:**
```bash
curl -X POST http://localhost:8080/extract-media \
  -H "Content-Type: application/json" \
  -d '{"url": "https://x.com/username/status/1234567890"}'
```

**Responses:**
- `202 Accepted`: Request received and queued for processing
- `400 Bad Request`: Invalid or missing URL

### 2. Refresh Session
**`POST /refresh-session`**

Forces a fresh login session, regardless of current session validity.

**Request:**
```bash
curl -X POST http://localhost:8080/refresh-session
```

**Responses:**
- `202 Accepted`: Session refresh started in background
- `500 Internal Server Error`: Failed to start refresh process

### 3. Session Status
**`GET /session-status`**

Checks the current authentication session status.

**Request:**
```bash
curl -X GET http://localhost:8080/session-status
```

**Response Example:**
```json
{
  "session_file_exists": true,
  "session_valid": true,
  "session_path": "/app/session-data/session.json"
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Web server port |
| `LOG_LEVEL` | `INFO` | Logging level (`INFO` or `DEBUG`) |
| `X_USERNAME` | *Required* | Twitter/X username |
| `X_PASSWORD` | *Required* | Twitter/X password |
| `OUTPUT_DIR` | `./downloads` | Media download directory |
| `SESSION_DIR` | `./session-data` | Session storage directory |

### Docker Run Examples

**Basic Usage:**
```bash
docker run -d \
  --name xmedia-downloader \
  -p 8080:8080 \
  -v "$(pwd)/downloads:/app/downloads" \
  -v "$(pwd)/session-data:/app/session-data" \
  -e X_USERNAME="your_username" \
  -e X_PASSWORD="your_password" \
  xmedia-downloader
```

**Custom Port:**
```bash
docker run -d \
  --name xmedia-downloader \
  -p 3000:3000 \
  -v "$(pwd)/downloads:/app/downloads" \
  -v "$(pwd)/session-data:/app/session-data" \
  -e PORT=3000 \
  -e X_USERNAME="your_username" \
  -e X_PASSWORD="your_password" \
  xmedia-downloader
```

**Debug Mode:**
```bash
docker run -d \
  --name xmedia-downloader \
  -p 8080:8080 \
  -v "$(pwd)/downloads:/app/downloads" \
  -v "$(pwd)/session-data:/app/session-data" \
  -v "$(pwd)/screenshots:/app/screenshots" \
  -e LOG_LEVEL=DEBUG \
  -e X_USERNAME="your_username" \
  -e X_PASSWORD="your_password" \
  xmedia-downloader
```

## Volume Mounts

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `./downloads` | `/app/downloads` | Downloaded media files |
| `./session-data` | `/app/session-data` | Authentication session storage |
| `./screenshots` | `/app/screenshots` | Login process screenshots (debug) |

## How It Works

The service orchestrates several components:

1. **Web Server**: Flask-based REST API that handles incoming requests
2. **Session Manager**: Maintains Twitter/X authentication sessions with automatic refresh
3. **Content Extractor**: Uses Playwright to scrape tweet metadata for filename generation
4. **API Client**: Leverages authenticated sessions to call Twitter's internal APIs
5. **Media Downloader**: Downloads and saves media files with descriptive names
6. **Asynchronous Processing**: Background threads handle time-consuming operations

## Workflow

1. **Request Received**: API endpoint receives POST request with Twitter/X URL
2. **URL Validation**: Validates the provided URL format
3. **Immediate Response**: Returns 202 status confirming request acceptance
4. **Background Processing**: 
   - Validates/refreshes authentication session
   - Extracts tweet metadata and media URLs
   - Downloads media files to mounted volume
5. **Logging**: All operations logged for monitoring and debugging

## Supported URL Formats

- `https://twitter.com/username/status/1234567890`
- `https://x.com/username/status/1234567890`
- `http://twitter.com/username/status/1234567890`
- `http://x.com/username/status/1234567890`

Query parameters and `www.` prefix are supported.

## Troubleshooting

### Enable Debug Logging
```bash
docker run ... -e LOG_LEVEL=DEBUG ...
```

### Check Session Status
```bash
curl -X GET http://localhost:8080/session-status
```

### Force Session Refresh
```bash
curl -X POST http://localhost:8080/refresh-session
```

### View Container Logs
```bash
docker logs xmedia-downloader
```

## File Naming Convention

Downloaded files follow this pattern:
```
YYYYMMDD_HHMMSS_username_tweetid_index.extension
```

Example: `20231027_153000_elonmusk_1234567890_1.mp4`
