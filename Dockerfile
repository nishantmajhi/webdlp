FROM denoland/deno:2.9.4

WORKDIR /app

# Install yt-dlp and its runtime dependencies (Python, ffmpeg). Deno itself
# is already the base image's runtime *and* doubles as the JS engine yt-dlp
# needs for YouTube signature solving (yt-dlp[default] pulls in yt-dlp-ejs,
# which shells out to `deno` on PATH - already satisfied by this image).
USER root
RUN apt-get update && \
    apt-get install -y python3 python3-pip ffmpeg curl ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages "yt-dlp[default]"

# Verify both tools are available
RUN yt-dlp --version && deno --version

# App code only uses Deno's built-in node:sqlite / node:path - no external
# packages to fetch, so there's nothing worth caching in its own layer.
COPY . .
RUN deno check main.ts

# Writable dirs for the SQLite db and downloaded files, and for cookie.txt
# which the app writes to the working directory.
RUN mkdir -p database downloads/temp && chmod -R 777 database downloads /app

# Run as the image's built-in non-root user
USER deno

ARG APP_PORT=5476
EXPOSE ${APP_PORT}

ENTRYPOINT ["deno", "run", "--allow-net", "--allow-run=yt-dlp", "--allow-read", "--allow-write", "--allow-env", "main.ts"]
