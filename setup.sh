#!/usr/bin/env bash
# setup.sh - Install Deno, yt-dlp, and ffmpeg for webdlp (Linux/macOS)
# Usage: bash setup.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }
section() { echo -e "\n${YELLOW}──── $1 ────${NC}"; }

# ─── Detect OS ────────────────────────────────────────────────────────────────
OS="$(uname -s)"
section "Detected OS: $OS"

# ─── Deno ─────────────────────────────────────────────────────────────────────
# Required both to run the app itself and as the JS runtime yt-dlp shells
# out to for YouTube signature solving (yt-dlp[default] pulls in yt-dlp-ejs).
section "Checking Deno"

if command -v deno &>/dev/null; then
    info "Deno already installed: $(deno --version | head -1)"
else
    warn "Deno not found - installing..."
    curl -fsSL https://deno.land/install.sh | sh
    export PATH="$HOME/.deno/bin:$PATH"
    if ! command -v deno &>/dev/null; then
        error "Deno install script finished but 'deno' is still not on PATH. Open a new terminal and re-run this script, or see https://docs.deno.com/runtime/getting_started/installation/"
    fi
    info "Deno installed successfully."
fi

# ─── ffmpeg ───────────────────────────────────────────────────────────────────
section "Checking ffmpeg"

if command -v ffmpeg &>/dev/null; then
    info "ffmpeg already installed: $(ffmpeg -version 2>&1 | head -1)"
else
    warn "ffmpeg not found - installing..."
    case "$OS" in
        Linux)
            if command -v apt-get &>/dev/null; then
                sudo apt-get update -q && sudo apt-get install -y ffmpeg
            elif command -v dnf &>/dev/null; then
                sudo dnf install -y ffmpeg
            elif command -v pacman &>/dev/null; then
                sudo pacman -Sy --noconfirm ffmpeg
            else
                error "Could not detect package manager. Install ffmpeg manually: https://ffmpeg.org/download.html"
            fi
            ;;
        Darwin)
            if command -v brew &>/dev/null; then
                brew install ffmpeg
            else
                error "Homebrew not found. Install it first: https://brew.sh, then re-run this script."
            fi
            ;;
        *)
            error "Unsupported OS: $OS. Install ffmpeg manually: https://ffmpeg.org/download.html"
            ;;
    esac
    info "ffmpeg installed successfully."
fi

# ─── yt-dlp ───────────────────────────────────────────────────────────────────
section "Checking yt-dlp"

YTDLP_BIN=""
if command -v yt-dlp &>/dev/null; then
    YTDLP_BIN="$(command -v yt-dlp)"
    info "yt-dlp already installed: $YTDLP_BIN"
fi

install_ytdlp_binary() {
    # Preferred: download the standalone binary (no Python needed)
    local DEST="/usr/local/bin/yt-dlp"
    local URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    if [[ "$OS" == "Darwin" ]]; then
        URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    fi
    warn "Downloading yt-dlp binary to $DEST ..."
    if command -v curl &>/dev/null; then
        sudo curl -L "$URL" -o "$DEST"
    elif command -v wget &>/dev/null; then
        sudo wget -O "$DEST" "$URL"
    else
        error "Neither curl nor wget found. Install one of them and re-run."
    fi
    sudo chmod +x "$DEST"
    YTDLP_BIN="$DEST"
}

if [[ -z "$YTDLP_BIN" ]]; then
    # Try pipx first, then pip, then binary download
    if command -v pipx &>/dev/null; then
        warn "Installing yt-dlp via pipx..."
        pipx install yt-dlp
        YTDLP_BIN="$(command -v yt-dlp 2>/dev/null || true)"
    elif command -v pip3 &>/dev/null; then
        warn "Installing yt-dlp via pip3..."
        pip3 install --user "yt-dlp[default]" 2>/dev/null || pip3 install --break-system-packages "yt-dlp[default]"
        YTDLP_BIN="$(command -v yt-dlp 2>/dev/null || true)"
    fi

    # Fall back to standalone binary if pip methods failed
    if [[ -z "$YTDLP_BIN" ]]; then
        install_ytdlp_binary
    fi

    info "yt-dlp installed successfully."
fi

# ─── Update yt-dlp ────────────────────────────────────────────────────────────
section "Updating yt-dlp"
"$YTDLP_BIN" -U 2>/dev/null || warn "Could not auto-update yt-dlp (may need sudo). Run 'yt-dlp -U' manually."

# ─── Verify ───────────────────────────────────────────────────────────────────
section "Final verification"
command -v deno &>/dev/null && info "deno: $(deno --version | head -1)" || error "deno not found in PATH after install."
command -v yt-dlp &>/dev/null && info "yt-dlp: $(yt-dlp --version)" || error "yt-dlp not found in PATH after install."
command -v ffmpeg &>/dev/null && info "ffmpeg: $(ffmpeg -version 2>&1 | head -1 | cut -d' ' -f1-3)" || error "ffmpeg not found in PATH after install."

echo ""
info "All dependencies ready. You can now run: deno task start"