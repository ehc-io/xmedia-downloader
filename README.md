
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
- **Dockerized**: Runs entirely within a Docker container
- **Google Cloud Storage Integration**: All session data, screenshots, and media files are stored in a GCS bucket

## Prerequisites

- [Docker](https://www.docker.com/get-started) installed and running
- A Twitter/X account with username, password, and email address
- A Google Cloud Storage bucket (with the VM's service account having read/write access)
- (Optional) Proxy server configuration if running in a corporate network

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
     -e X_USERNAME="your_twitter_username" \
     -e X_PASSWORD="your_twitter_password" \
     -e X_EMAIL="your_email@domain.com" \
     -e GCS_BUCKET_NAME="your-gcs-bucket-name" \
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
  "session_path": "x-session.json (in GCS bucket)"
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
| `X_EMAIL` | *Optional* | Twitter/X email (required if email confirmation appears during login) |
| `PROXY` | *Optional* | Proxy server configuration (format: `ip:port` or `username:password@ip:port`) |
| `GCS_BUCKET_NAME` | *Required* | Google Cloud Storage bucket for all persistent data |
| `NETWORK_TIMEOUT` | `30000` | (ms) Timeout for network operations (page loads, navigation) |
| `INTERACTION_TIMEOUT` | `5000` | (ms) Timeout for UI interactions and element waits |

### Docker Run Example

```bash
docker run -d \
  --name xmedia-downloader \
  -p 8080:8080 \
  -e X_USERNAME="your_username" \
  -e X_PASSWORD="your_password" \
  -e X_EMAIL="your_email@domain.com" \
  -e GCS_BUCKET_NAME="your-gcs-bucket-name" \
  -e NETWORK_TIMEOUT=45000 \
  -e INTERACTION_TIMEOUT=3000 \
  xmedia-downloader
```

**With Proxy:**
```bash
docker run -d \
  --name xmedia-downloader \
  -p 8080:8080 \
  -e X_USERNAME="your_username" \
  -e X_PASSWORD="your_password" \
  -e X_EMAIL="your_email@domain.com" \
  -e PROXY="proxy.example.com:8080" \
  -e GCS_BUCKET_NAME="your-gcs-bucket-name" \
  xmedia-downloader
```

**Debug Mode:**
```bash
docker run -d \
  --name xmedia-downloader \
  -p 8080:8080 \
  -e LOG_LEVEL=DEBUG \
  -e X_USERNAME="your_username" \
  -e X_PASSWORD="your_password" \
  -e X_EMAIL="your_email@domain.com" \
  -e GCS_BUCKET_NAME="your-gcs-bucket-name" \
  xmedia-downloader
```

## Persistent Storage (GCS)

All persistent data (session file, screenshots, downloaded media) is stored in the specified Google Cloud Storage bucket. There is no need to mount local volumes for these files.

| GCS Path Prefix | Purpose |
|-----------------|---------|
| `session-data/x-session.json` | Authentication session storage |
| `screenshots/` | Login process screenshots (with timestamps and error states) |
| `media/` | Downloaded media files |

### Screenshot Storage
Screenshots are automatically captured during the login process for debugging purposes:
- **Login flow**: Page states during authentication steps
- **Error states**: Screenshots when timeouts or failures occur  
- **Email confirmation**: Screenshots when email verification is required
- **Timestamped filenames**: Format: `YYYY-MM-DDTHH-MM-SS-filename.png`

## How It Works

The service orchestrates several components:

1. **Web Server**: Flask-based REST API that handles incoming requests
2. **Session Manager**: Maintains Twitter/X authentication sessions with automatic refresh, storing session in GCS
3. **Content Extractor**: Uses Playwright to scrape tweet metadata and upload screenshots to GCS
4. **API Client**: Leverages authenticated sessions to call Twitter's internal APIs
5. **Media Downloader**: Downloads and uploads media files directly to GCS
6. **Asynchronous Processing**: Background threads handle time-consuming operations

## Workflow

1. **Request Received**: API endpoint receives POST request with Twitter/X URL
2. **URL Validation**: Validates the provided URL format
3. **Immediate Response**: Returns 202 status confirming request acceptance
4. **Background Processing**: 
   - Validates/refreshes authentication session (session file in GCS)
   - Extracts tweet metadata and media URLs
   - Downloads media files and uploads to GCS
   - Captures and uploads screenshots to GCS
5. **Logging**: All operations logged for monitoring and debugging

## Supported URL Formats

- `https://twitter.com/username/status/1234567890`
- `https://x.com/username/status/1234567890`
- `http://twitter.com/username/status/1234567890`
- `http://x.com/username/status/1234567890`

Query parameters and `www.` prefix are supported.

## Authentication Notes

### Email Confirmation
Twitter/X sometimes requires email confirmation during login after entering the username. The system automatically handles this by:
- Detecting when the email confirmation field appears
- Using the `X_EMAIL` environment variable to fill the field
- Clicking the Next button to proceed with the regular login flow

If email confirmation is required but `X_EMAIL` is not set, the login will fail with a clear error message.

### Proxy Support
The system supports HTTP proxy configuration for networks requiring proxy access:
- **Simple proxy**: `PROXY="proxy.example.com:8080"`
- **Authenticated proxy**: `PROXY="username:password@proxy.example.com:8080"`

## Troubleshooting

### Enable Debug Logging
```bash
docker run ... -e LOG_LEVEL=DEBUG ...
```

### Common Issues

**Network Timeouts:**
- Increase `NETWORK_TIMEOUT` for slow connections: `-e NETWORK_TIMEOUT=60000`
- Check proxy configuration if using a proxy server
- Test direct connection by removing `PROXY` environment variable

**Email Confirmation Required:**
- Error: "Email confirmation required but X_EMAIL environment variable not set"
- Solution: Add `-e X_EMAIL="your_email@domain.com"` to Docker run command

**Screenshot Failures:**
- Screenshots may timeout on slow systems (10-second limit)
- Login process continues even if screenshots fail
- Check GCS bucket permissions if upload fails

**Proxy Issues:**
- Validate proxy server connectivity: `curl -x proxy.example.com:8080 https://x.com`
- Check proxy authentication credentials
- Verify proxy URL format in logs

### Debugging Commands

**Check Session Status:**
```bash
curl -X GET http://localhost:8080/session-status
```

**Force Session Refresh:**
```bash
curl -X POST http://localhost:8080/refresh-session
```

**View Container Logs:**
```bash
docker logs xmedia-downloader
```

**Test Without Proxy:**
```bash
docker run ... # (remove -e PROXY=... from command)
```

## File Naming Convention

Downloaded files follow this pattern:
```
YYYYMMDD_HHMMSS_username_tweetid_index.extension
```

Example: `20231027_153000_elonmusk_1234567890_1.mp4`
