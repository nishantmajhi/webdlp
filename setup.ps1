# setup.ps1 - Install Deno, yt-dlp, and ffmpeg for webdlp (Windows)
# Usage: Right-click -> "Run with PowerShell", or: powershell -ExecutionPolicy Bypass -File setup.ps1

#Requires -Version 5.0
$ErrorActionPreference = "Stop"

function Info    { Write-Host "[OK] $args" -ForegroundColor Green }
function Warn    { Write-Host "[!] $args" -ForegroundColor Yellow }
function Section { Write-Host "`n---- $args ----" -ForegroundColor Yellow }
function Fail    { Write-Host "[X] $args" -ForegroundColor Red; exit 1 }

# --- Admin check --------------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Warn "Not running as Administrator. Some installs may require elevation."
    Warn "If anything fails, re-run PowerShell as Administrator."
}

# --- Helper: ensure a dir is in PATH ------------------------------------------
function Add-ToPath([string]$dir) {
    $current = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($current -notlike "*$dir*") {
        [Environment]::SetEnvironmentVariable("PATH", "$current;$dir", "User")
        $env:PATH += ";$dir"
        Warn "Added $dir to PATH. Restart your terminal to use it in future sessions."
    }
}

# --- Install dir --------------------------------------------------------------
$installDir = "$env:LOCALAPPDATA\webdlp-tools"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

# --- Deno ---------------------------------------------------------------------
# Required both to run the app itself and as the JS runtime yt-dlp shells
# out to for YouTube signature solving (yt-dlp[default] pulls in yt-dlp-ejs).
Section "Checking Deno"

$denoPath = Get-Command deno -ErrorAction SilentlyContinue
if ($denoPath) {
    Info "Deno already installed: $($denoPath.Source)"
} else {
    $installed = $false

    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Warn "Installing Deno via winget..."
        try {
            winget install --id DenoLand.Deno --accept-package-agreements --accept-source-agreements -e
            $installed = $true
        } catch {
            Warn "winget install failed, trying next method..."
        }
    }

    if (-not $installed -and (Get-Command choco -ErrorAction SilentlyContinue)) {
        Warn "Installing Deno via Chocolatey..."
        try {
            choco install deno -y
            $installed = $true
        } catch {
            Warn "choco install failed, trying next method..."
        }
    }

    if (-not $installed) {
        Warn "Installing Deno via the official install script..."
        try {
            irm https://deno.land/install.ps1 | iex
            Add-ToPath "$env:USERPROFILE\.deno\bin"
            $installed = $true
        } catch {
            Fail "Could not install Deno automatically. Visit https://docs.deno.com/runtime/getting_started/installation/ and install manually."
        }
    }

    if ($installed) { Info "Deno installed successfully." }
}

# --- ffmpeg -------------------------------------------------------------------
Section "Checking ffmpeg"

$ffmpegPath = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ffmpegPath) {
    Info "ffmpeg already installed: $($ffmpegPath.Source)"
} else {
    # Try winget first, then chocolatey, then manual download
    $installed = $false

    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Warn "Installing ffmpeg via winget..."
        try {
            winget install --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements -e
            $installed = $true
        } catch {
            Warn "winget install failed, trying next method..."
        }
    }

    if (-not $installed -and (Get-Command choco -ErrorAction SilentlyContinue)) {
        Warn "Installing ffmpeg via Chocolatey..."
        try {
            choco install ffmpeg -y
            $installed = $true
        } catch {
            Warn "choco install failed, trying next method..."
        }
    }

    if (-not $installed) {
        # Manual binary download (essentials build from github)
        Warn "Downloading ffmpeg essentials build..."
        $ffmpegZip = "$env:TEMP\ffmpeg.zip"
        $ffmpegExtract = "$env:TEMP\ffmpeg-extract"

        # Use the latest essentials release from gyan.dev (stable)
        $ffmpegUrl = "https://github.com/GyanD/codexffmpeg/releases/latest/download/ffmpeg-release-essentials.zip"
        try {
            Invoke-WebRequest -Uri $ffmpegUrl -OutFile $ffmpegZip -UseBasicParsing
            Expand-Archive -Path $ffmpegZip -DestinationPath $ffmpegExtract -Force
            $ffBin = Get-ChildItem -Recurse -Path $ffmpegExtract -Filter "ffmpeg.exe" | Select-Object -First 1
            Copy-Item $ffBin.FullName "$installDir\ffmpeg.exe" -Force
            Add-ToPath $installDir
            $installed = $true
        } catch {
            Fail "Could not download ffmpeg automatically. Install manually from https://ffmpeg.org/download.html and add to PATH."
        }
    }

    if ($installed) { Info "ffmpeg installed successfully." }
}

# --- yt-dlp -------------------------------------------------------------------
Section "Checking yt-dlp"

$ytdlpPath = Get-Command yt-dlp -ErrorAction SilentlyContinue
if ($ytdlpPath) {
    Info "yt-dlp already installed: $($ytdlpPath.Source)"
} else {
    $installed = $false

    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Warn "Installing yt-dlp via winget..."
        try {
            winget install --id yt-dlp.yt-dlp --accept-package-agreements --accept-source-agreements -e
            $installed = $true
        } catch {
            Warn "winget install failed, trying next method..."
        }
    }

    if (-not $installed -and (Get-Command choco -ErrorAction SilentlyContinue)) {
        Warn "Installing yt-dlp via Chocolatey..."
        try {
            choco install yt-dlp -y
            $installed = $true
        } catch {
            Warn "choco install failed, trying next method..."
        }
    }

    if (-not $installed -and (Get-Command pip -ErrorAction SilentlyContinue)) {
        Warn "Installing yt-dlp via pip..."
        try {
            pip install "yt-dlp[default]"
            $installed = $true
        } catch {
            Warn "pip install failed, trying standalone binary..."
        }
    }

    if (-not $installed) {
        # Download standalone .exe
        Warn "Downloading yt-dlp standalone binary..."
        $ytdlpDest = "$installDir\yt-dlp.exe"
        try {
            Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" `
                -OutFile $ytdlpDest -UseBasicParsing
            Add-ToPath $installDir
            $installed = $true
        } catch {
            Fail "Could not download yt-dlp. Visit https://github.com/yt-dlp/yt-dlp/releases and place yt-dlp.exe in your PATH."
        }
    }

    if ($installed) { Info "yt-dlp installed successfully." }
}

# --- Update yt-dlp ------------------------------------------------------------
Section "Updating yt-dlp to latest"
try {
    yt-dlp -U
} catch {
    Warn "Could not auto-update yt-dlp. Run 'yt-dlp -U' manually later."
}

# --- Verify -------------------------------------------------------------------
Section "Final verification"

$denoOk = Get-Command deno -ErrorAction SilentlyContinue
$ytOk = Get-Command yt-dlp -ErrorAction SilentlyContinue
$ffOk = Get-Command ffmpeg -ErrorAction SilentlyContinue

if ($denoOk) { Info "deno: $(deno --version | Select-Object -First 1)" } else { Fail "deno not found in PATH. Restart your terminal and try again." }
if ($ytOk) { Info "yt-dlp: $(yt-dlp --version)" } else { Fail "yt-dlp not found in PATH. Restart your terminal and try again." }
if ($ffOk) { Info "ffmpeg: $(ffmpeg -version 2>&1 | Select-Object -First 1)" } else { Fail "ffmpeg not found in PATH. Restart your terminal and try again." }

Write-Host ""
Info "All dependencies ready. You can now run: deno task start"