# =====================================================================
#  Audio Recorder - one-time setup for a new Windows PC
#  Installs Python (if missing), ffmpeg (if missing), and all the
#  Python packages the app needs, in the order that works.
# =====================================================================
$ErrorActionPreference = "Stop"
$CpuIndex = "https://download.pytorch.org/whl/cpu"

function Info($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "OK  $m"  -ForegroundColor Green }
function Warn($m) { Write-Host "!!  $m"  -ForegroundColor Yellow }

Write-Host ""
Write-Host "======================================================"
Write-Host "  Audio Recorder - Setup"
Write-Host "======================================================"
Write-Host ""

# --- 1. Python --------------------------------------------------------
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) {
    Warn "Python is not installed."
    Info "Installing Python 3.13 via winget..."
    winget install --id Python.Python.3.13 -e --accept-package-agreements --accept-source-agreements
    Write-Host ""
    Warn "Python was just installed. CLOSE this window, open a NEW one,"
    Warn "and run Setup.bat again so Python is on the PATH."
    Read-Host "Press Enter to exit"
    exit
}
Ok ("Python found: " + (python --version 2>&1))

# --- 2. ffmpeg --------------------------------------------------------
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Warn "ffmpeg not found. Installing via winget..."
    try {
        winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements
        Warn "ffmpeg installed. A NEW terminal (or sign out/in) may be needed"
        Warn "for it to appear on the PATH."
    } catch {
        Warn "Could not auto-install ffmpeg. Install it manually and ensure"
        Warn "'ffmpeg' works from a terminal (https://www.gyan.dev/ffmpeg/builds/)."
    }
} else {
    Ok "ffmpeg found."
}

# --- 3. Python packages ----------------------------------------------
Info "Upgrading pip..."
python -m pip install --upgrade pip | Out-Null

Info "Installing core packages (recording + transcription + tray)..."
python -m pip install soundcard sounddevice numpy pillow pystray faster-whisper

Info "Installing pyannote.audio (speaker separation)..."
python -m pip install "pyannote.audio"

# PyTorch must match torchaudio exactly; pin the CPU builds LAST so they
# override whatever pyannote pulled in.
$torchOK = $false
try {
    $v = python -c "import torch,torchaudio;print(torch.__version__+' '+torchaudio.__version__)" 2>$null
    if ($v -match "2\.9\.1\+cpu 2\.9\.1\+cpu") { $torchOK = $true }
} catch {}
if ($torchOK) {
    Ok "PyTorch already correct (2.9.1+cpu)."
} else {
    Info "Installing matching PyTorch CPU build (large download)..."
    python -m pip install torch==2.9.1 torchaudio==2.9.1 --index-url $CpuIndex --force-reinstall
}

# --- 4. Verify --------------------------------------------------------
Info "Verifying the install..."
$check = "import soundcard, sounddevice, numpy, PIL, pystray, faster_whisper, torch, torchaudio, pyannote.audio; print('imports-ok')"
$result = python -c $check 2>&1
if ($result -match "imports-ok") {
    Write-Host ""
    Ok "All packages imported successfully."
    Write-Host ""
    Write-Host "Setup complete." -ForegroundColor Green
    Write-Host "Launch the app with:  Launch Audio Recorder.vbs"
    Write-Host ""
    Write-Host "For speaker names, open the app and paste a HuggingFace token"
    Write-Host "(see README.md -> 'One-time setup: HuggingFace token')."
} else {
    Write-Host ""
    Warn "Something did not import cleanly:"
    Write-Host $result
    Warn "Re-run this script, or check the message above."
}
Write-Host ""
Read-Host "Press Enter to exit"
