# Stage 1: Builder - Install dependencies and prepare the application
FROM python:3.11-slim-bookworm AS builder

# Set the working directory
WORKDIR /app

# Install system dependencies required for Node.js and Playwright
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl gnupg libglib2.0-0 && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy dependency files first to leverage Docker layer caching
COPY requirements.txt package.json ./

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install Node.js dependencies
RUN npm install --omit=dev

# Install Playwright browser (Chromium) and its system dependencies
# The --with-deps flag is crucial as it installs all necessary OS libraries
RUN playwright install --with-deps chromium

# Copy the rest of the application source code
COPY . .

# --- Stage 2: Final Image ---
# Use a clean base image for the final stage
FROM python:3.11-slim-bookworm

# Install system dependencies needed by Playwright/Chromium at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libasound2 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    libxkbcommon0 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libfontconfig1 \
    libharfbuzz0b \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# --- Environment Variables ---
# These environment variables are REQUIRED for the session refresh script.
# Pass them during 'docker run' using the -e flag.
# Example: docker run -e X_USERNAME="myuser" -e X_PASSWORD="mypassword" ...
ENV OUTPUT_DIR="/app/downloads"
ENV SESSION_DIR="/app/session-data"


# Create a non-root user to run the application
RUN useradd --create-home --shell /bin/bash appuser

# Copy installed dependencies and application from the builder stage
COPY --from=builder /app /app
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /root/.cache/ms-playwright /home/appuser/.cache/ms-playwright
COPY --from=builder /usr/bin/node /usr/bin/node
COPY --from=builder /usr/lib/node_modules /usr/lib/node_modules

# Copy the entrypoint script and make it executable
COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

# Create directories for output and session data
RUN mkdir -p /app/downloads /app/session-data && \
    chown -R appuser:appuser /app /home/appuser

# Switch to the non-root user
USER appuser

# Define mount points for persisting data outside the container.
# Example: docker run -v $(pwd)/downloads:/app/downloads -v $(pwd)/sessions:/app/session-data ...
VOLUME ["/app/downloads", "/app/session-data"]

# --- Entrypoint & Command ---
# This setup allows you to run the container and pass arguments directly
# to the python script.
#
# HOW TO RUN:
# Build the image:
#   docker build -t xmedia-downloader .
#
# Run the container:
#   docker run --rm -it \
#     -e X_USERNAME="YOUR_USERNAME" \
#     -e X_PASSWORD="YOUR_PASSWORD" \
#     -v "$(pwd)/downloads:/app/downloads" \
#     -v "$(pwd)/session-data:/app/session-data" \
#     xmedia-downloader \
#     --url "https://x.com/user/status/1234567890" \
#     --verbose
#
# To force a session refresh:
#   docker run --rm -it \
#     -e X_USERNAME="YOUR_USERNAME" \
#     -e X_PASSWORD="YOUR_PASSWORD" \
#     -v "$(pwd)/session-data:/app/session-data" \
#     xmedia-downloader \
#     refresh-session
ENTRYPOINT ["entrypoint.sh"]

# Default command shows the help message if no other command is provided.
CMD ["--help"]
