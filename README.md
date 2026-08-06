# webdlp

A modern, lightweight web application for downloading videos using yt-dlp, built with **Deno** and TypeScript.

## ✨ Features

- 🦕 **Deno-native** - No external dependencies; uses Deno's built-in `node:sqlite` for storage and `Deno.Command` to drive yt-dlp
- 🐳 **Docker Ready** - One-command deployment; yt-dlp and ffmpeg installed automatically
- 💾 **Smart Caching** - SQLite database tracks downloads and serves cached files
- 📊 **Real-time Progress** - Live yt-dlp output streaming via Server-Sent Events
- 🎯 **Single Source URLs** - Warns and reuses existing downloads
- ⏭️ **Playlist-Resilient** - A bad item (age-restricted, region-locked, deleted, etc.) is skipped, not fatal; the rest of the playlist keeps downloading and skipped items are listed once everything finishes
- 🔧 **Easy Configuration** - Environment-based settings via `.env` file
- 📱 **Responsive Design** - Clean, modern UI that works on all devices
- ⚡ **Concurrent Downloads** - Support for multiple simultaneous downloads

## ☁️ A note on hosting: why not Deno Deploy?

yt-dlp's default JS runtime for solving YouTube's signature challenges is now **Deno** - but that's a runtime *dependency of yt-dlp*, unrelated to where you host this app. **Deno Deploy** (Deno's own hosting platform) runs code in V8 isolates at the edge, similar to Cloudflare Workers. That model doesn't support:

- **Spawning subprocesses** - this app's whole job is to run `yt-dlp`/`ffmpeg` as child processes, which isolates can't do.
- **Persistent disk** - downloaded videos and the SQLite database need real, persistent storage between requests.

So while the backend here is 100% Deno/TypeScript, it's meant to run anywhere that gives you a normal process + a real filesystem: **Docker** (recommended, see below), a VPS, Fly.io, Render, or any container platform. Running it locally with `deno task start` works the same way.

## 🚀 Quick Start

### Option A - Docker (Recommended, zero setup)

Docker automatically installs **Deno**, **yt-dlp**, and **ffmpeg** inside the container - no manual steps needed.

```bash
git clone https://github.com/nishantmajhi/webdlp.git
cd webdlp
docker-compose up -d
```

Open **http://localhost:5476** - that's it.

---

### Option B - Without Docker

You need three things on your machine before running the app:

| Dependency | Purpose                                       | Install                                                                       |
| ---------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Deno       | Runs the app (and yt-dlp's signature solver)   | [docs.deno.com](https://docs.deno.com/runtime/getting_started/installation/) |
| yt-dlp     | Downloads videos                               | See below                                                                       |
| ffmpeg     | Merges audio/video                             | See below                                                                       |

#### Automated install (recommended)

Run the setup script for your OS - it detects what's missing and installs everything automatically:

**Linux / macOS**

```bash
bash setup.sh
```

**Windows (PowerShell)**

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

Both scripts try multiple install methods (package managers → standalone binaries) and verify the result at the end.

#### Manual install

<details>
<summary>Deno manual install options</summary>

**Linux/macOS**

```bash
curl -fsSL https://deno.land/install.sh | sh
```

**macOS (Homebrew)**

```bash
brew install deno
```

**Windows - winget**

```powershell
winget install DenoLand.Deno
```

**Windows - PowerShell script**

```powershell
irm https://deno.land/install.ps1 | iex
```

See [docs.deno.com/runtime/getting_started/installation](https://docs.deno.com/runtime/getting_started/installation/) for all options.

</details>

<details>
<summary>yt-dlp manual install options</summary>

**Linux/macOS - standalone binary (no Python required)**

```bash
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp
sudo chmod +x /usr/local/bin/yt-dlp
```

**via pip** (use the `[default]` extras - they include yt-dlp-ejs, which is what talks to Deno for signature solving)

```bash
pip install "yt-dlp[default]"          # or:
pipx install "yt-dlp[default]"         # isolated environment (recommended)
```

**Windows - winget**

```powershell
winget install yt-dlp.yt-dlp
```

**Windows - Chocolatey**

```powershell
choco install yt-dlp
```

**Windows - standalone .exe**
Download `yt-dlp.exe` from [github.com/yt-dlp/yt-dlp/releases](https://github.com/yt-dlp/yt-dlp/releases/latest) and place it anywhere in your `PATH`.

</details>

<details>
<summary>ffmpeg manual install options</summary>

**Ubuntu / Debian**

```bash
sudo apt-get install ffmpeg
```

**Fedora**

```bash
sudo dnf install ffmpeg
```

**Arch**

```bash
sudo pacman -S ffmpeg
```

**macOS (Homebrew)**

```bash
brew install ffmpeg
```

**Windows - winget**

```powershell
winget install Gyan.FFmpeg
```

**Windows - Chocolatey**

```powershell
choco install ffmpeg
```

**Windows - manual**
Download the essentials build from [ffmpeg.org/download.html](https://ffmpeg.org/download.html) and add the `bin/` folder to your `PATH`.

</details>

#### Verify before running

```bash
deno --version      # should print a version, e.g. deno 2.9.4
yt-dlp --version    # should print a version, e.g. 2026.07.04
ffmpeg -version     # should print ffmpeg version x.x.x ...
```

If any command is not found, revisit the install steps above before proceeding.

#### Run the app

```bash
git clone https://github.com/nishantmajhi/webdlp.git
cd webdlp
deno task start
```

Open **http://localhost:5476**.

## 📦 Installation

### Prerequisites summary

| Method | Deno         | yt-dlp             | ffmpeg             |
| ------ | ------------ | ------------------ | ------------------ |
| Docker | ✅ Not needed | ✅ Auto-installed  | ✅ Auto-installed  |
| Local  | ✅ Required  | ✅ Required        | ✅ Required        |

### Step 1: Clone the Repository

```bash
git clone https://github.com/nishantmajhi/webdlp.git
cd webdlp
```

### Step 2: Build and Run

#### With Docker

```bash
docker-compose up -d
```

#### Without Docker

```bash
# 1. Install dependencies (pick your method above, or run setup.sh / setup.ps1)
# 2. Run
deno task start
```

## ⚙️ Configuration

### Environment Variables

Create or edit the `.env` file in the project root:

```bash
# Application Port (default: 5476)
APP_PORT=5476
```

### Deno permissions

The app runs with the minimum permissions it needs, declared explicitly rather than via a broad `--allow-all`:

| Flag                 | Why it's needed                                                     |
| --------------------- | --------------------------------------------------------------------- |
| `--allow-net`         | Serves HTTP                                                          |
| `--allow-run=yt-dlp`  | Spawns the `yt-dlp` subprocess (nothing else)                        |
| `--allow-read`        | Reads `static/`, `cookie.txt`, the SQLite file, downloaded files     |
| `--allow-write`       | Writes `cookie.txt`, downloaded files, the SQLite file               |
| `--allow-env`         | Reads `APP_PORT` from the environment                                |

These are already wired up in `deno.json`'s `start`/`dev` tasks and in the `Dockerfile`'s `ENTRYPOINT`.

### Docker Configuration

The `docker-compose.yml` file includes:

- Port mapping from `.env`
- Volume mounts for downloads and database
- Automatic restart policy

## 📖 Usage

1. **Open the Application** - Navigate to `http://localhost:5476` (or your configured port)
2. **Enter a Video URL** - Paste any valid YouTube (or supported site) URL
3. **Start Download** - Click "Start Download" and watch real-time progress
4. **Download Complete** - Browser prompts to save; file is also kept in `downloads/`
5. **Re-downloading the Same URL** - App detects duplicates and serves the existing file instantly

## 🔄 How It Works

1. **URL Submission** - User submits a URL; client generates a unique hash ID
2. **Duplicate Check** - Server checks SQLite for an existing download
   - Found → serves cached file immediately
   - Not found → proceeds to download
3. **Download Process** - yt-dlp downloads to `downloads/temp/`; progress streamed via SSE
4. **File Management** - Completed file moved to `downloads/`; path stored in SQLite
5. **File Delivery** - Browser triggered to download; original kept for future requests; range requests are supported for resumable/streamed downloads

## 🔌 API Endpoints

### `GET /`

Returns the main HTML interface.

### `GET /download?url={url}&id={id}&options={json}`

Initiates a download.

| Parameter | Type   | Description                                        |
| --------- | ------ | --------------------------------------------------- |
| `url`     | string | Video URL                                           |
| `id`      | string | Unique identifier for this download                 |
| `options` | string | JSON array of `{arg, value?}` yt-dlp option objects |

**Response:** `200 OK` or `400 Bad Request`

### `GET /progress?id={id}`

Server-Sent Events stream of real-time download progress. For playlist URLs, a bad item (age-restricted, region-blocked, deleted, etc.) is skipped rather than aborting the rest of the playlist. Just before the stream ends, a `summary:{...}` message is sent with a JSON payload of `{ succeeded: number, failed: [{ extractor?, videoId?, message }] }`, then the stream ends with `done` (if at least one file succeeded) or `error` (if none did).

**Response:** Stream of progress messages

### `GET /file?id={id}&index={index}`

Downloads a completed file. Supports `Range` requests. `index` (default `0`) selects which file when a playlist produced more than one - see `GET /files`.

**Response:** File download or `404 Not Found`

### `GET /files?id={id}`

Lists every file a download produced, e.g. `{ "files": [{ "index": 0, "fileName": "..." }, ...] }`. Useful when a playlist download finishes with multiple files.

**Response:** JSON

### `GET /error?id={id}`

Returns the captured yt-dlp output for a failed download, for diagnostics.

**Response:** Plain text transcript

### `GET /cookie/status`

Returns `{ "hasCookie": boolean }`.

### `POST /cookie`

Body: `{ "cookieText": "# Netscape HTTP Cookie File\n..." }`. Saves a Netscape-format cookie file for authenticated downloads.

### `DELETE /cookie`

Clears the saved cookie file.

## 💻 Development

```bash
deno task start   # Run in production mode
deno task dev      # Run with --watch (auto-restarts on file changes)
deno task check    # Type-check without running
```

### Code Structure

- **main.ts** - HTTP server, routing, request handlers
- **src/db.ts** - SQLite schema init, URL/file tracking (via `node:sqlite`)
- **src/downloadService.ts** - yt-dlp process management, SSE streaming, file handling
- **src/static.ts** - Static file + ranged file-download helpers

## 🐛 Troubleshooting

### deno, yt-dlp, or ffmpeg not found (local dev)

Run the setup script:

```bash
bash setup.sh        # Linux/macOS
# or
powershell -ExecutionPolicy Bypass -File setup.ps1   # Windows
```

Then verify:

```bash
deno --version
yt-dlp --version
ffmpeg -version
```

If a command still isn't found after install, your shell's `PATH` may not have updated yet - open a new terminal window and try again.

### Port already in use

```bash
# Change port in .env
APP_PORT=8080

# Restart
docker-compose down && docker-compose up -d
```

### Permission issues (downloads folder)

```bash
sudo chown -R $USER:$USER downloads
# or
sudo chmod -R 755 downloads
```

### Database locked

```bash
docker-compose down
rm database/downloads.sqlite3   # will be recreated on next start
docker-compose up -d
```

### Docker build issues

```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Downloads folder not persisting

Confirm these volume mounts exist in `docker-compose.yml`:

```yaml
volumes:
  - ./downloads:/app/downloads
  - ./database:/app/database
```

## 🤝 Contributing

1. **Report Bugs** - Open an issue describing the bug
2. **Suggest Features** - Open an issue with your idea
3. **Submit Pull Requests** - Fix bugs or add features
4. **Improve Documentation** - PRs welcome

### Guidelines

- Follow existing code style
- Comment complex logic
- Test thoroughly
- Update docs as needed

## 📄 License

MIT - see [LICENSE](LICENSE).

## 🙏 Acknowledgments

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - Amazing video downloader
- [Deno](https://deno.com/) - Secure-by-default JavaScript/TypeScript runtime
- SQLite (via Deno's built-in [`node:sqlite`](https://docs.deno.com/api/node/sqlite/)) - Lightweight database engine
