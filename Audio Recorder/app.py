#!/usr/bin/env python3
"""
Audio Recorder + Diarized Transcript

- Records ONLY the computer's own audio (system/loopback — what's playing through
  the speakers), not the microphone.
- Transcribes it with faster-whisper.
- Separates speakers with pyannote.audio and labels each segment (Speaker 1/2/3...).
- Lets you rename speakers, then exports a .txt transcript.

Everything runs locally. pyannote needs a free HuggingFace token (one-time setup)
and license acceptance — see README.md.
"""
import json
import queue
import threading
import time
import wave
from datetime import datetime
from pathlib import Path

import numpy as np
import tkinter as tk
from tkinter import ttk, messagebox, filedialog

APP_DIR = Path(__file__).resolve().parent
RECORDINGS_DIR = APP_DIR / "recordings"
TRANSCRIPTS_DIR = APP_DIR / "transcripts"
CONFIG_PATH = APP_DIR / "config.json"
ICON_PATH = APP_DIR / "recorder_icon.ico"
SAMPLE_RATE = 48000  # native-ish; whisper/pyannote resample internally

WINDOW_TITLE = "Audio Recorder + Diarized Transcript"
APP_ID = "Axus.AudioRecorder"          # taskbar identity
MUTEX_NAME = "Axus.AudioRecorder.Singleton"

# Action-button colours (base, pressed/active)
GREEN,  GREEN_ACTIVE  = "#2e7d32", "#1b5e20"   # Start Recording
RED,    RED_ACTIVE    = "#c62828", "#8e0000"   # Stop Recording
YELLOW, YELLOW_ACTIVE = "#f9a825", "#f57f17"   # Pause / Resume

# "Delete older than" presets -> age in days (insertion order = dropdown order)
RETENTION_OPTIONS = {
    "1 minute": 1 / (24 * 60),
    "1 hour": 1 / 24,
    "1 day": 1, "3 days": 3, "7 days": 7,
    "2 weeks": 14, "4 weeks": 28,
    "1 month": 30, "3 months": 90, "6 months": 180, "12 months": 365,
}

RECORDINGS_DIR.mkdir(exist_ok=True)
TRANSCRIPTS_DIR.mkdir(exist_ok=True)


# --------------------------------------------------------------------------- #
# Taskbar icon (red bold "R") + single-instance helpers
# --------------------------------------------------------------------------- #
def ensure_icon() -> Path | None:
    """Generate a red-bold-'R' .ico for the taskbar/title bar (cached on disk)."""
    if ICON_PATH.exists():
        return ICON_PATH
    try:
        from PIL import Image, ImageDraw, ImageFont
        base = 256
        img = Image.new("RGBA", (base, base), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        m = 10
        d.rounded_rectangle([m, m, base - m, base - m], radius=46,
                            fill=(255, 255, 255, 255),
                            outline=(150, 150, 150, 255), width=5)
        try:
            font = ImageFont.truetype("arialbd.ttf", 200)
        except Exception:
            font = ImageFont.load_default()
        bbox = d.textbbox((0, 0), "R", font=font)
        x = (base - (bbox[2] - bbox[0])) / 2 - bbox[0]
        y = (base - (bbox[3] - bbox[1])) / 2 - bbox[1]
        d.text((x, y), "R", font=font, fill=(200, 0, 0, 255))  # bold red R
        img.save(ICON_PATH, format="ICO",
                 sizes=[(s, s) for s in (256, 128, 64, 48, 32, 16)])
        return ICON_PATH
    except Exception:
        return None


def flash_existing_window() -> None:
    """Blink the taskbar button of the already-running instance."""
    try:
        import ctypes
        ctypes.windll.user32.FindWindowW.restype = ctypes.c_void_p
        hwnd = ctypes.windll.user32.FindWindowW(None, WINDOW_TITLE)
        if not hwnd:
            return

        class FLASHWINFO(ctypes.Structure):
            _fields_ = [("cbSize", ctypes.c_uint), ("hwnd", ctypes.c_void_p),
                        ("dwFlags", ctypes.c_uint), ("uCount", ctypes.c_uint),
                        ("dwTimeout", ctypes.c_uint)]

        FLASHW_ALL, FLASHW_TIMERNOFG = 0x3, 0xC   # flash until user focuses it
        info = FLASHWINFO(ctypes.sizeof(FLASHWINFO), hwnd,
                          FLASHW_ALL | FLASHW_TIMERNOFG, 0, 0)
        ctypes.windll.user32.FlashWindowEx(ctypes.byref(info))
    except Exception:
        pass


def already_running() -> bool:
    """True if another instance holds the named mutex. Keeps the handle alive."""
    try:
        import ctypes
        global _MUTEX_HANDLE
        _MUTEX_HANDLE = ctypes.windll.kernel32.CreateMutexW(None, False, MUTEX_NAME)
        return ctypes.windll.kernel32.GetLastError() == 183  # ERROR_ALREADY_EXISTS
    except Exception:
        return False


_MUTEX_HANDLE = None


# --------------------------------------------------------------------------- #
# Auto-start at Windows login (a shortcut in the user's Startup folder)
# --------------------------------------------------------------------------- #
def _startup_lnk() -> Path:
    import os
    return (Path(os.environ["APPDATA"]) / "Microsoft" / "Windows"
            / "Start Menu" / "Programs" / "Startup" / "Audio Recorder.lnk")


def autostart_enabled() -> bool:
    try:
        return _startup_lnk().exists()
    except Exception:
        return False


def set_autostart(enable: bool) -> bool:
    """Create/remove the login shortcut. Returns the resulting state."""
    lnk = _startup_lnk()
    try:
        if enable:
            vbs = APP_DIR / "Launch Audio Recorder.vbs"
            ps = (
                "$w=New-Object -ComObject WScript.Shell;"
                f"$s=$w.CreateShortcut('{lnk}');"
                "$s.TargetPath='wscript.exe';"
                f"$s.Arguments='\"{vbs}\"';"
                f"$s.WorkingDirectory='{APP_DIR}';"
                f"$s.IconLocation='{ICON_PATH}';"
                "$s.Description='Audio Recorder';$s.Save()"
            )
            import subprocess
            no_window = 0x08000000
            subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                            "-Command", ps], capture_output=True, creationflags=no_window)
        else:
            if lnk.exists():
                lnk.unlink()
    except Exception:
        pass
    return autostart_enabled()


# --------------------------------------------------------------------------- #
# Config (stores the HuggingFace token)
# --------------------------------------------------------------------------- #
def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_config(cfg: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


# --------------------------------------------------------------------------- #
# Microphone device discovery
# --------------------------------------------------------------------------- #
# Host-API preference (lower = preferred). MME first: reliable and it doesn't
# contend with the WASAPI loopback the way a WASAPI mic can. WDM-KS and other
# exotic/exclusive back-ends are hidden entirely.
_API_RANK = {"MME": 0, "Windows DirectSound": 1, "Windows WASAPI": 2}
# Generic/virtual "devices" that aren't a real microphone.
_EXCLUDE_SUBSTR = ("sound mapper", "primary sound capture", "stereo mix", "pc speaker")
_GROUP_KEY_LEN = 18  # enough to merge a truncated MME name with its full WASAPI twin


def _device_group_key(name: str) -> str:
    return name.strip().lower()[:_GROUP_KEY_LEN]


def list_input_devices() -> list[tuple[int, str]]:
    """One clean entry per physical microphone: [(index, 'Clean Name')].

    Collapses the same mic exposed through several host APIs into a single row,
    picking a reliable back-end under the hood and the fullest available name for
    display. Hides low-level (WDM-KS) and generic mapper devices."""
    import sounddevice as sd
    apis = sd.query_hostapis()
    groups: dict[str, dict] = {}
    for i, d in enumerate(sd.query_devices()):
        if d.get("max_input_channels", 0) <= 0:
            continue
        api = apis[d["hostapi"]]["name"]
        if api not in _API_RANK:                       # skip WDM-KS etc.
            continue
        name = d["name"].strip()
        if any(s in name.lower() for s in _EXCLUDE_SUBSTR):
            continue
        rank = _API_RANK[api]
        key = _device_group_key(name)
        g = groups.get(key)
        if g is None:
            groups[key] = {"rank": rank, "index": i, "display": name}
        else:
            if rank < g["rank"]:                       # more reliable back-end
                g["rank"], g["index"] = rank, i
            if len(name) > len(g["display"]):          # fuller name for display
                g["display"] = name
    out = [(g["index"], g["display"]) for g in groups.values()]
    out.sort(key=lambda t: t[1].lower())
    return out


def resolve_input_index(label: str):
    """Map a saved label back to a current device index (None if not found)."""
    if not label:
        return None
    for i, lbl in list_input_devices():
        if lbl == label:
            return i
    return None


def default_input_label():
    """Display name (from the curated list) of the system default input, or None."""
    import sounddevice as sd
    try:
        di = sd.default.device[0]
        if di is None or di < 0:
            return None
        key = _device_group_key(sd.query_devices()[di]["name"])
        for _, disp in list_input_devices():
            if _device_group_key(disp) == key:
                return disp
        return None
    except Exception:
        return None


# --------------------------------------------------------------------------- #
# Loopback recorder (records the computer's output audio)
# --------------------------------------------------------------------------- #
class ConversationRecorder:
    """Records the computer's output audio (loopback) and, optionally, the
    microphone at the same time, then mixes them into one WAV — so both sides
    of a conversation are captured."""

    def __init__(self, samplerate: int = SAMPLE_RATE, include_mic: bool = True,
                 mic_device=None):
        self.samplerate = samplerate
        self.include_mic = include_mic
        self.mic_device = mic_device            # sounddevice index, or None = default
        self._sys_frames: list[np.ndarray] = []
        self._mic_frames: list[np.ndarray] = []
        self._mic_sr = samplerate
        self._recording = False
        self._threads: list[threading.Thread] = []
        self._sys_error: str | None = None
        self._mic_error: str | None = None
        self._mic_warning: str | None = None
        self._paused = False

    def start(self) -> None:
        self._sys_frames = []
        self._mic_frames = []
        self._sys_error = None
        self._mic_error = None
        self._mic_warning = None
        self._paused = False
        self._recording = True
        self._threads = [threading.Thread(target=self._record_loopback, daemon=True)]
        if self.include_mic:
            self._threads.append(threading.Thread(target=self._record_mic, daemon=True))
        for t in self._threads:
            t.start()

    def pause(self) -> None:
        self._paused = True

    def resume(self) -> None:
        self._paused = False

    def _record_loopback(self) -> None:
        # soundcard's WASAPI loopback uses COM, which must be initialized in THIS
        # thread. A fresh thread per recording isn't initialized by default, which
        # can make a later recording fail with 0x800401F0 (CO_E_NOTINITIALIZED).
        com_ready = False
        try:
            import ctypes
            ctypes.windll.ole32.CoInitializeEx(None, 0x2)  # COINIT_APARTMENTTHREADED
            com_ready = True
        except Exception:
            pass
        try:
            import soundcard as sc
            speaker = sc.default_speaker()
            loopback = sc.get_microphone(id=str(speaker.name), include_loopback=True)
            with loopback.recorder(samplerate=self.samplerate, channels=1) as rec:
                block = self.samplerate // 10  # 100 ms
                while self._recording:
                    data = rec.record(numframes=block)  # keep draining the buffer
                    if not self._paused:                # ...but drop it while paused
                        self._sys_frames.append(data.copy())
        except Exception as e:
            self._sys_error = f"{type(e).__name__}: {e}"
        finally:
            if com_ready:
                try:
                    import ctypes
                    ctypes.windll.ole32.CoUninitialize()
                except Exception:
                    pass

    def _record_mic(self) -> None:
        # soundcard can't open most real mics on Windows (it asserts a specific
        # WASAPI format), so use sounddevice/PortAudio for the microphone.
        try:
            self._open_mic_stream(self.mic_device)
        except Exception as e:
            # A specific device can refuse to open (exclusive/host quirks).
            # Fall back to the system default mic so the voice is still captured.
            if self.mic_device is not None:
                try:
                    self._mic_frames = []
                    self._open_mic_stream(None)
                    self._mic_warning = (
                        f"Selected mic couldn't be opened ({type(e).__name__}); "
                        "recorded with the default microphone instead.")
                    return
                except Exception as e2:
                    self._mic_error = f"{type(e2).__name__}: {e2}"
            else:
                self._mic_error = f"{type(e).__name__}: {e}"

    def _open_mic_stream(self, device) -> None:
        import sounddevice as sd
        # Record at the device's native rate; resample at mix time.
        info = (sd.query_devices(device, "input")
                if device is not None else sd.query_devices(kind="input"))
        self._mic_sr = int(info["default_samplerate"])

        def callback(indata, frames_count, time_info, status):
            if self._recording and not self._paused:
                self._mic_frames.append(indata.copy())

        with sd.InputStream(samplerate=self._mic_sr, channels=1, dtype="float32",
                            device=device, callback=callback):
            while self._recording:
                time.sleep(0.05)

    @staticmethod
    def _resample(x: np.ndarray, sr_from: int, sr_to: int) -> np.ndarray:
        if x.size == 0 or sr_from == sr_to:
            return x
        n_to = int(round(x.size * sr_to / sr_from))
        t_from = np.linspace(0.0, 1.0, x.size, endpoint=False)
        t_to = np.linspace(0.0, 1.0, n_to, endpoint=False)
        return np.interp(t_to, t_from, x).astype(np.float32)

    @staticmethod
    def _flatten(frames: list[np.ndarray]) -> np.ndarray:
        if not frames:
            return np.zeros(0, dtype=np.float32)
        return np.concatenate(frames, axis=0).reshape(-1).astype(np.float32)

    def stop(self):
        """Stop, mix the streams, write a WAV.

        Returns (wav_path | None, warning | None)."""
        self._recording = False
        for t in self._threads:
            t.join(timeout=5)

        # Loopback failing is fatal; mic failing is a warning (keep system audio).
        if self._sys_error and not self._sys_frames:
            raise RuntimeError(f"System-audio capture failed: {self._sys_error}")

        sys_a = self._flatten(self._sys_frames)
        mic_a = self._flatten(self._mic_frames) if self.include_mic else np.zeros(0, np.float32)
        # match the mic to the loopback sample rate before mixing
        mic_a = self._resample(mic_a, self._mic_sr, self.samplerate)

        warning = None
        if self.include_mic:
            if self._mic_error and mic_a.size == 0:
                warning = f"Microphone capture failed ({self._mic_error}); saved system audio only."
            elif self._mic_warning:
                warning = self._mic_warning

        if sys_a.size and mic_a.size:
            n = min(sys_a.size, mic_a.size)          # align to shorter stream
            mixed = sys_a[:n] + mic_a[:n]
        elif sys_a.size:
            mixed = sys_a
        elif mic_a.size:
            mixed = mic_a
            if not warning:
                warning = "No system audio captured; saved microphone only."
        else:
            return None, warning

        peak = float(np.max(np.abs(mixed))) if mixed.size else 0.0
        if peak > 1.0:                                # prevent clipping after the sum
            mixed = mixed / peak
        pcm16 = (np.clip(mixed, -1.0, 1.0) * 32767).astype(np.int16)

        # millisecond-precise, plus a guard, so every recording is its own file
        ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S_%f")[:-3]
        out = RECORDINGS_DIR / f"recording_{ts}.wav"
        counter = 1
        while out.exists():
            out = RECORDINGS_DIR / f"recording_{ts}_{counter}.wav"
            counter += 1
        with wave.open(str(out), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self.samplerate)
            wf.writeframes(pcm16.tobytes())
        return out, warning


# --------------------------------------------------------------------------- #
# Transcription + diarization pipeline (runs in a worker thread)
# --------------------------------------------------------------------------- #
def _extract_wav16k(src: Path) -> Path:
    """ffmpeg -> temp 16 kHz mono WAV. Normalizes any input (wav/mp4/m4a...)."""
    import subprocess, tempfile
    tmp = Path(tempfile.gettempdir()) / f"arec_{int(time.time()*1000)}.wav"
    cmd = ["ffmpeg", "-y", "-i", str(src), "-vn", "-ac", "1",
           "-ar", "16000", "-c:a", "pcm_s16le", str(tmp)]
    # CREATE_NO_WINDOW (0x08000000) keeps ffmpeg from flashing a console window
    # when the app is launched with pythonw.exe.
    no_window = 0x08000000 if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
    r = subprocess.run(cmd, capture_output=True, text=True, creationflags=no_window)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {r.stderr[-500:]}")
    return tmp


def _load_waveform(wav_path: Path):
    """Load a 16 kHz mono WAV into pyannote's in-memory format.

    Avoids torchaudio/torchcodec file decoding (whose native DLLs don't load
    with this torch build on Windows)."""
    import torch
    with wave.open(str(wav_path), "rb") as wf:
        sr = wf.getframerate()
        n = wf.getnframes()
        ch = wf.getnchannels()
        raw = wf.readframes(n)
    data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        data = data.reshape(-1, ch).mean(axis=1)
    waveform = torch.from_numpy(data).unsqueeze(0)  # (channel=1, time)
    return {"waveform": waveform, "sample_rate": sr}


def run_pipeline(wav_path: Path, model_size: str, hf_token: str,
                 num_speakers, log) -> list[dict]:
    """
    Returns a list of segments: {start, end, speaker, text}.
    `log(msg)` posts progress to the GUI. `num_speakers` may be None (auto) or int.
    """
    # Normalize input to a clean 16 kHz mono WAV first.
    log("Extracting audio...")
    work_wav = _extract_wav16k(Path(wav_path))

    # 1) Transcribe -------------------------------------------------------- #
    log(f"Loading transcription model '{model_size}'...")
    from faster_whisper import WhisperModel
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    log("Transcribing audio...")
    segments_iter, info = model.transcribe(str(work_wav), vad_filter=True)
    whisper_segs = [
        {"start": s.start, "end": s.end, "text": s.text.strip()}
        for s in segments_iter if s.text.strip()
    ]
    log(f"Detected language: {info.language}. {len(whisper_segs)} segments.")
    if not whisper_segs:
        return []

    # 2) Diarize ----------------------------------------------------------- #
    turns = []
    if hf_token:
        try:
            log("Loading speaker-diarization model (first run downloads it)...")
            from pyannote.audio import Pipeline
            import torch
            # pyannote.audio 4.x ships the self-contained "community-1" pipeline;
            # 3.x used "speaker-diarization-3.1". Try the modern one, fall back.
            last_err = None
            pipeline = None
            for model_id in ("pyannote/speaker-diarization-community-1",
                             "pyannote/speaker-diarization-3.1"):
                try:
                    try:                            # newer pyannote/hf API
                        pipeline = Pipeline.from_pretrained(model_id, token=hf_token)
                    except TypeError:               # older API
                        pipeline = Pipeline.from_pretrained(model_id, use_auth_token=hf_token)
                    break
                except Exception as ex:
                    last_err = ex
            if pipeline is None:
                raise last_err
            pipeline.to(torch.device("cpu"))

            log("Identifying speakers...")
            kwargs = {}
            if num_speakers:
                kwargs["num_speakers"] = int(num_speakers)
            audio_in = _load_waveform(work_wav)
            result = pipeline(audio_in, **kwargs)
            # 4.x returns a DiarizeOutput wrapping the annotation; 3.x returns the
            # annotation itself.
            annotation = getattr(result, "speaker_diarization", result)
            for turn, _, spk in annotation.itertracks(yield_label=True):
                turns.append((turn.start, turn.end, spk))
            log(f"Found {len({t[2] for t in turns})} distinct speaker(s).")
        except Exception as e:
            msg = str(e).lower()
            if "gated" in type(e).__name__.lower() or "restricted" in msg \
                    or "403" in msg or "awaiting" in msg:
                log("Speaker labeling needs one-time access approval on HuggingFace.")
                log("Sign in at https://huggingface.co and click 'Agree'/'Accept' on:")
                log("     https://huggingface.co/pyannote/speaker-diarization-community-1")
                log("     https://huggingface.co/pyannote/speaker-diarization-3.1")
                log("     https://huggingface.co/pyannote/segmentation-3.0")
                log("Approval is usually instant; then transcribe again.")
            else:
                log(f"Diarization failed ({type(e).__name__}: {e}).")
            log("Saved transcript without speaker labels for now.")
            turns = []
    else:
        log("No HuggingFace token set — skipping speaker separation.")

    # 3) Assign a speaker to each transcript segment ----------------------- #
    # normalize pyannote labels (SPEAKER_00 -> "Speaker 1") in first-seen order
    label_map: dict[str, str] = {}

    def speaker_for(seg) -> str:
        if not turns:
            return "Speaker 1"
        mid = (seg["start"] + seg["end"]) / 2
        best, best_overlap = None, 0.0
        for ts, te, spk in turns:
            overlap = min(seg["end"], te) - max(seg["start"], ts)
            if overlap > best_overlap:
                best_overlap, best = overlap, spk
        if best is None:  # midpoint fallback
            for ts, te, spk in turns:
                if ts <= mid <= te:
                    best = spk
                    break
        if best is None:
            best = turns[0][2]
        if best not in label_map:
            label_map[best] = f"Speaker {len(label_map) + 1}"
        return label_map[best]

    for seg in whisper_segs:
        seg["speaker"] = speaker_for(seg)

    try:
        work_wav.unlink(missing_ok=True)
    except Exception:
        pass
    return whisper_segs


def render_transcript(segments: list[dict], name_map: dict[str, str]) -> str:
    """Group consecutive same-speaker segments into readable blocks."""
    lines, cur_spk, buf = [], None, []

    def flush():
        if buf:
            display = name_map.get(cur_spk, cur_spk)
            lines.append(f"{display}: {' '.join(buf)}")

    for seg in segments:
        spk = seg["speaker"]
        if spk != cur_spk:
            flush()
            cur_spk, buf = spk, []
        buf.append(seg["text"])
    flush()
    return "\n\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# GUI
# --------------------------------------------------------------------------- #
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(WINDOW_TITLE)
        self.geometry("800x740")
        self.minsize(740, 640)

        icon = ensure_icon()
        if icon:
            try:
                self.iconbitmap(default=str(icon))   # title bar + taskbar icon
            except Exception:
                pass

        self.cfg = load_config()
        self.recorder: ConversationRecorder | None = None
        self.msg_q: queue.Queue = queue.Queue()
        self.segments: list[dict] = []
        self.last_wav: Path | None = None
        self.current_transcript_path: Path | None = None
        self.is_recording = False
        self.is_paused = False
        self._elapsed_base = 0.0     # recorded seconds before the current segment
        self._segment_start = 0.0    # time the current running segment began
        self.speaker_name_vars: dict[str, tk.StringVar] = {}
        self.tray_icon = None
        self._tray_notified = False
        self._link_counter = 0
        self._hist_rows: dict[str, tuple] = {}
        self._last_click_row = None
        self._last_click_t = 0.0

        self._build_ui()
        self._refresh_history()
        self.after(100, self._drain_queue)
        self.after(200, self._tick_timer)

        # Live in the system tray: closing the window hides it there instead of
        # quitting, so the app is always running and one click away.
        self._setup_tray()
        self.protocol("WM_DELETE_WINDOW", self.hide_to_tray)

    # ---- system tray ------------------------------------------------------
    def _setup_tray(self):
        try:
            import pystray
            from PIL import Image
        except Exception:
            self.tray_icon = None
            return
        image = None
        try:
            if ICON_PATH.exists():
                # load into memory and CLOSE the file so it isn't left locked
                # (a held handle would block "Package for sharing").
                with Image.open(ICON_PATH) as im:
                    image = im.convert("RGBA").copy()
        except Exception:
            image = None
        if image is None:
            image = Image.new("RGBA", (64, 64), (200, 0, 0, 255))
        menu = pystray.Menu(
            pystray.MenuItem("Open Audio Recorder", self._tray_show, default=True),
            pystray.MenuItem("Quit", self._tray_quit),
        )
        self.tray_icon = pystray.Icon("AxusAudioRecorder", image, WINDOW_TITLE, menu)
        threading.Thread(target=self.tray_icon.run, daemon=True).start()

    def _tray_show(self, icon=None, item=None):
        self.after(0, self._show_window)

    def _show_window(self):
        self.deiconify()
        self.state("normal")
        self.lift()
        self.attributes("-topmost", True)
        self.attributes("-topmost", False)
        self.focus_force()

    def _tray_quit(self, icon=None, item=None):
        def _do():
            try:
                if self.tray_icon is not None:
                    self.tray_icon.stop()
            except Exception:
                pass
            self.destroy()
        self.after(0, _do)

    def hide_to_tray(self):
        if self.tray_icon is not None:
            try:
                self.log_window.withdraw()   # hide the log window too
            except Exception:
                pass
            self.withdraw()
            if not self._tray_notified:
                self._tray_notified = True
                try:
                    self.tray_icon.notify(
                        "Still running here — click this icon to reopen.",
                        "Audio Recorder")
                except Exception:
                    pass
        else:
            self.destroy()

    # ---- UI layout --------------------------------------------------------
    def _build_ui(self):
        pad = {"padx": 10, "pady": 6}

        # Recording controls
        rec_frame = ttk.LabelFrame(self, text="1. Record computer audio")
        rec_frame.pack(fill="x", **pad)

        top = ttk.Frame(rec_frame)
        top.pack(fill="x")
        btn_font = ("Segoe UI", 9, "bold")
        self.record_btn = tk.Button(top, text="● Start Recording",
                                    command=self.toggle_record,
                                    bg=GREEN, fg="white", activebackground=GREEN_ACTIVE,
                                    activeforeground="white", font=btn_font,
                                    relief="raised", bd=2, padx=10, pady=4, cursor="hand2")
        self.record_btn.pack(side="left", padx=10, pady=10)
        self.pause_btn = tk.Button(top, text="Pause", command=self.toggle_pause,
                                   state="disabled",
                                   bg=YELLOW, fg="black", activebackground=YELLOW_ACTIVE,
                                   activeforeground="black", disabledforeground="#7a7a7a",
                                   font=btn_font, relief="raised", bd=2, padx=10, pady=4,
                                   cursor="hand2")
        self.pause_btn.pack(side="left", padx=(0, 6))
        self.timer_lbl = ttk.Label(top, text="00:00", font=("Segoe UI", 16))
        self.timer_lbl.pack(side="left", padx=10)
        self.rec_status = ttk.Label(top, text="Idle")
        self.rec_status.pack(side="left", padx=10)

        # Microphone selection row
        mic_row = ttk.Frame(rec_frame)
        mic_row.pack(fill="x", padx=10, pady=(0, 8))
        self.mic_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(mic_row, text="Record my mic:",
                        variable=self.mic_var).pack(side="left")
        self.mic_label_var = tk.StringVar()
        self.mic_combo = ttk.Combobox(mic_row, textvariable=self.mic_label_var,
                                      state="readonly", width=48)
        self.mic_combo.pack(side="left", padx=6)
        self.mic_combo.bind("<<ComboboxSelected>>", self._on_mic_selected)
        ttk.Button(mic_row, text="Refresh", width=8,
                   command=self._populate_mics).pack(side="left")
        self._populate_mics()

        # Options
        opt_frame = ttk.LabelFrame(self, text="2. Options")
        opt_frame.pack(fill="x", **pad)
        ttk.Label(opt_frame, text="Accuracy:").grid(row=0, column=0, sticky="w", padx=8, pady=6)
        self.model_var = tk.StringVar(value="base")
        ttk.Combobox(opt_frame, textvariable=self.model_var, width=12, state="readonly",
                     values=["tiny", "base", "small", "medium", "large-v3"]
                     ).grid(row=0, column=1, sticky="w", padx=8)
        ttk.Label(opt_frame, text="# Speakers (blank = auto):").grid(row=0, column=2, sticky="w", padx=8)
        self.speakers_var = tk.StringVar(value="")
        ttk.Entry(opt_frame, textvariable=self.speakers_var, width=6
                  ).grid(row=0, column=3, sticky="w", padx=8)

        ttk.Label(opt_frame, text="HuggingFace token:").grid(row=1, column=0, sticky="w", padx=8, pady=6)
        self.token_var = tk.StringVar(value=self.cfg.get("hf_token", ""))
        ttk.Entry(opt_frame, textvariable=self.token_var, width=42, show="•"
                  ).grid(row=1, column=1, columnspan=2, sticky="w", padx=8)
        ttk.Button(opt_frame, text="Save token", command=self.save_token
                   ).grid(row=1, column=3, sticky="w", padx=8)

        self.autostart_var = tk.BooleanVar(value=autostart_enabled())
        ttk.Checkbutton(opt_frame,
                        text="Start automatically at Windows login (stays in the system tray)",
                        variable=self.autostart_var, command=self._toggle_autostart
                        ).grid(row=2, column=0, columnspan=4, sticky="w", padx=8, pady=(2, 8))

        # Process
        proc_frame = ttk.LabelFrame(self, text="3. Transcribe + identify speakers")
        proc_frame.pack(fill="x", **pad)
        self.process_btn = ttk.Button(proc_frame, text="Transcribe last recording",
                                      command=self.start_processing, state="disabled")
        self.process_btn.pack(side="left", padx=10, pady=10)
        ttk.Button(proc_frame, text="Transcribe a WAV/MP4 file",
                   command=self.pick_file).pack(side="left", padx=6)
        ttk.Button(proc_frame, text="Open output folder",
                   command=self.open_output).pack(side="left", padx=6)
        ttk.Button(proc_frame, text="Show log / preview",
                   command=self._show_log).pack(side="left", padx=6)

        # Speaker renaming
        self.rename_frame = ttk.LabelFrame(self, text="4. Rename speakers, then export")
        self.rename_frame.pack(fill="x", **pad)
        self.rename_inner = ttk.Frame(self.rename_frame)
        self.rename_inner.pack(fill="x", padx=8, pady=6)
        ttk.Label(self.rename_frame,
                  text="(Transcribe something to list detected speakers here.)"
                  ).pack(anchor="w", padx=8)
        self.export_btn = ttk.Button(self.rename_frame, text="Apply names & export .txt",
                                     command=self.export_txt, state="disabled")
        self.export_btn.pack(anchor="w", padx=8, pady=8)

        # History (recording <-> matching transcript)
        hist_frame = ttk.LabelFrame(self, text="5. History — recordings and matching transcripts")
        hist_frame.pack(fill="both", expand=True, **pad)
        ttk.Label(hist_frame, foreground="#555",
                  text="Newest on top. Click a Recording or Transcript to open it."
                  ).pack(anchor="w", padx=8, pady=(4, 0))

        tree_wrap = ttk.Frame(hist_frame)
        tree_wrap.pack(fill="both", expand=True, padx=8, pady=(4, 2))
        cols = ("recording", "transcript")
        self.hist_tree = ttk.Treeview(tree_wrap, columns=cols, show="headings", height=6)
        self.hist_tree.heading("recording", text="Recording")
        self.hist_tree.heading("transcript", text="Transcript")
        self.hist_tree.column("recording", width=340, anchor="w")
        self.hist_tree.column("transcript", width=340, anchor="w")
        vsb = ttk.Scrollbar(tree_wrap, orient="vertical", command=self.hist_tree.yview)
        self.hist_tree.configure(yscrollcommand=vsb.set)
        self.hist_tree.pack(side="left", fill="both", expand=True)
        vsb.pack(side="right", fill="y")
        self.hist_tree.bind("<ButtonRelease-1>", self._on_hist_click)

        ctrl = ttk.Frame(hist_frame)
        ctrl.pack(fill="x", padx=8, pady=(2, 8))
        ttk.Button(ctrl, text="Open recording",
                   command=self._open_selected_recording).pack(side="left")
        ttk.Button(ctrl, text="Open transcript",
                   command=self._open_selected_transcript).pack(side="left", padx=6)
        ttk.Button(ctrl, text="Delete selected",
                   command=self._delete_selected).pack(side="left")
        ttk.Button(ctrl, text="Refresh",
                   command=self._refresh_history).pack(side="left", padx=6)
        ttk.Label(ctrl, text="    Delete older than:").pack(side="left")
        self.retention_var = tk.StringVar(value="3 months")
        ttk.Combobox(ctrl, textvariable=self.retention_var, state="readonly", width=10,
                     values=list(RETENTION_OPTIONS.keys())).pack(side="left", padx=4)
        ttk.Button(ctrl, text="Delete",
                   command=self._delete_older_than).pack(side="left")

        # Log / transcript preview lives in its own window (opened via a button),
        # not on the main screen. Kept hidden until requested.
        self.log_window = tk.Toplevel(self)
        self.log_window.withdraw()                      # hide before it can flash
        self.log_window.title("Log / transcript preview")
        self.log_window.geometry("640x460")
        log_wrap = ttk.Frame(self.log_window)
        log_wrap.pack(fill="both", expand=True)
        self.log_txt = tk.Text(log_wrap, wrap="word")
        log_vsb = ttk.Scrollbar(log_wrap, orient="vertical", command=self.log_txt.yview)
        self.log_txt.configure(yscrollcommand=log_vsb.set)
        self.log_txt.pack(side="left", fill="both", expand=True, padx=(6, 0), pady=6)
        log_vsb.pack(side="right", fill="y", pady=6)
        # Closing the log window just hides it (the app keeps logging to it).
        self.log_window.protocol("WM_DELETE_WINDOW", self.log_window.withdraw)

    # ---- helpers ----------------------------------------------------------
    def log(self, msg: str):
        self.msg_q.put(("log", msg))

    def log_file(self, prefix: str, path):
        """Log a line whose file path is a clickable link that opens the file."""
        self.msg_q.put(("link", (prefix, str(path))))

    def _drain_queue(self):
        try:
            while True:
                kind, payload = self.msg_q.get_nowait()
                if kind == "log":
                    self.log_txt.insert("1.0", payload + "\n")   # newest on top
                    self.log_txt.see("1.0")
                elif kind == "link":
                    self._insert_link(*payload)
                elif kind == "done":
                    self._on_processing_done(payload)
                elif kind == "error":
                    messagebox.showerror("Error", payload)
                    self.process_btn.config(state="normal")
        except queue.Empty:
            pass
        self.after(100, self._drain_queue)

    def _insert_link(self, prefix: str, path: str):
        """Prepend 'prefix<clickable path>' at the top of the log (newest first);
        clicking the path opens the file."""
        tag = f"link{self._link_counter}"
        self._link_counter += 1
        self.log_txt.insert("1.0", prefix + path + "\n")     # newest on top
        # tag only the path portion on line 1
        self.log_txt.tag_add(tag, f"1.{len(prefix)}", f"1.{len(prefix) + len(path)}")
        self.log_txt.tag_config(tag, foreground="#1a73e8", underline=True)
        self.log_txt.tag_bind(tag, "<Button-1>", lambda e, p=path: self._open_path(p))
        self.log_txt.tag_bind(tag, "<Enter>", lambda e: self.log_txt.config(cursor="hand2"))
        self.log_txt.tag_bind(tag, "<Leave>", lambda e: self.log_txt.config(cursor=""))
        self.log_txt.see("1.0")

    def _open_path(self, p: str):
        import os
        if os.path.exists(p):
            try:
                os.startfile(p)
            except Exception as e:
                messagebox.showerror("Open failed", str(e))
        else:
            messagebox.showwarning("Not found", f"File no longer exists:\n{p}")

    # ---- history table ----------------------------------------------------
    def _refresh_history(self):
        """Rebuild the recording<->transcript table, newest first."""
        rows: dict[str, list] = {}
        for w in RECORDINGS_DIR.glob("*.wav"):
            rows.setdefault(w.stem, [None, None])[0] = w
        for t in TRANSCRIPTS_DIR.glob("*.txt"):
            rows.setdefault(t.stem, [None, None])[1] = t

        def newest(pair):
            times = [p.stat().st_mtime for p in pair if p and p.exists()]
            return max(times) if times else 0.0

        ordered = sorted(rows.items(), key=lambda kv: newest(kv[1]), reverse=True)
        self.hist_tree.delete(*self.hist_tree.get_children())
        self._hist_rows = {}
        for stem, (rec, txt) in ordered:
            self.hist_tree.insert("", "end", iid=stem,
                                  values=(rec.name if rec else "—",
                                          txt.name if txt else "(not transcribed)"))
            self._hist_rows[stem] = (rec, txt)

    def _on_hist_click(self, event):
        """Single click on a cell opens that file (recording or transcript)."""
        if self.hist_tree.identify_region(event.x, event.y) != "cell":
            return
        row = self.hist_tree.identify_row(event.y)
        col = self.hist_tree.identify_column(event.x)
        if not row:
            return
        now = time.time()
        if row == self._last_click_row and (now - self._last_click_t) < 0.6:
            return  # ignore the 2nd click of a double-click (avoid opening twice)
        self._last_click_row, self._last_click_t = row, now
        rec, txt = self._hist_rows.get(row, (None, None))
        if col == "#2" and txt:
            self._open_path(str(txt))
        elif col == "#1" and rec:
            self._open_path(str(rec))

    def _show_log(self):
        self.log_window.deiconify()
        self.log_window.lift()
        self.log_window.focus_force()

    def _selected_pair(self):
        sel = self.hist_tree.selection()
        if not sel:
            return None, None, None
        rec, txt = self._hist_rows.get(sel[0], (None, None))
        return sel[0], rec, txt

    def _open_selected_recording(self):
        _, rec, _ = self._selected_pair()
        if rec:
            self._open_path(str(rec))
        else:
            messagebox.showinfo("No recording", "Select a row that has a recording.")

    def _open_selected_transcript(self):
        _, _, txt = self._selected_pair()
        if txt:
            self._open_path(str(txt))
        else:
            messagebox.showinfo("No transcript", "That item hasn't been transcribed yet.")

    def _delete_files(self, *paths) -> int:
        n = 0
        for p in paths:
            try:
                if p and Path(p).exists():
                    Path(p).unlink()
                    n += 1
            except Exception as e:
                self.log(f"Could not delete {p}: {e}")
        return n

    def _delete_selected(self):
        stem, rec, txt = self._selected_pair()
        if not stem:
            messagebox.showinfo("Nothing selected", "Select a row to delete.")
            return
        names = [p.name for p in (rec, txt) if p]
        if messagebox.askyesno(
                "Delete",
                "Permanently delete:\n\n" + "\n".join(names) +
                "\n\nThis cannot be undone."):
            self._delete_files(rec, txt)
            self._refresh_history()
            self.log(f"Deleted: {', '.join(names)}")

    def _delete_older_than(self):
        label = self.retention_var.get()
        days = RETENTION_OPTIONS.get(label)
        if not days:
            return
        cutoff = time.time() - days * 86400
        victims = []
        for stem, (rec, txt) in self._hist_rows.items():
            times = [Path(p).stat().st_mtime for p in (rec, txt)
                     if p and Path(p).exists()]
            if times and max(times) < cutoff:
                victims.append((rec, txt))
        if not victims:
            messagebox.showinfo("Delete history",
                                f"Nothing is older than {label}.")
            return
        if messagebox.askyesno(
                "Delete history",
                f"Delete {len(victims)} item(s) older than {label}?\n\n"
                "Each recording AND its matching transcript will be permanently "
                "deleted. This cannot be undone."):
            total = 0
            for rec, txt in victims:
                total += self._delete_files(rec, txt)
            self._refresh_history()
            self.log(f"Deleted {len(victims)} item(s) older than {label} "
                     f"({total} files).")

    def _elapsed(self) -> float:
        """Recorded seconds so far, excluding any paused time."""
        running = 0.0 if (self.is_paused or not self.is_recording) \
            else time.time() - self._segment_start
        return self._elapsed_base + running

    def _tick_timer(self):
        if self.is_recording:
            secs = int(self._elapsed())
            suffix = "  (paused)" if self.is_paused else ""
            self.timer_lbl.config(text=f"{secs // 60:02d}:{secs % 60:02d}{suffix}")
        self.after(200, self._tick_timer)

    # ---- microphone selection --------------------------------------------
    def _populate_mics(self):
        """Fill the mic dropdown and restore the saved selection."""
        try:
            devices = list_input_devices()
        except Exception as e:
            self.log(f"Could not list microphones: {e}")
            devices = []
        labels = [lbl for _, lbl in devices]
        self.mic_combo["values"] = labels

        saved = self.cfg.get("mic_label", "")
        if saved and saved in labels:
            self.mic_label_var.set(saved)
        else:
            default_lbl = default_input_label()
            self.mic_label_var.set(default_lbl if default_lbl in labels
                                   else (labels[0] if labels else ""))

    def _on_mic_selected(self, _event=None):
        self.cfg["mic_label"] = self.mic_label_var.get()
        save_config(self.cfg)
        self.log(f"Microphone set to: {self.mic_label_var.get()}")

    # ---- recording --------------------------------------------------------
    def toggle_pause(self):
        if not self.is_recording or self.recorder is None:
            return
        if not self.is_paused:
            # bank the time recorded in this segment, then pause
            self._elapsed_base += time.time() - self._segment_start
            self.is_paused = True
            self.recorder.pause()
            self.pause_btn.config(text="Resume")
            self.rec_status.config(text="Paused")
            self.log("Recording paused.")
        else:
            self._segment_start = time.time()
            self.is_paused = False
            self.recorder.resume()
            self.pause_btn.config(text="Pause")
            self.rec_status.config(text="Recording...")
            self.log("Recording resumed.")

    def toggle_record(self):
        if not self.is_recording:
            include_mic = self.mic_var.get()
            mic_index = resolve_input_index(self.mic_label_var.get()) if include_mic else None
            self.recorder = ConversationRecorder(include_mic=include_mic,
                                                 mic_device=mic_index)
            self.recorder.start()
            self.is_recording = True
            self.is_paused = False
            self._elapsed_base = 0.0
            self._segment_start = time.time()
            self.record_btn.config(text="■ Stop Recording",
                                   bg=RED, activebackground=RED_ACTIVE)
            self.pause_btn.config(text="Pause", state="normal")
            src = "system audio + microphone" if include_mic else "system audio"
            self.rec_status.config(text=f"Recording {src}...")
            self.log(f"Recording started ({src}).")
        else:
            self.is_recording = False
            self.is_paused = False
            self.record_btn.config(text="● Start Recording",
                                   bg=GREEN, activebackground=GREEN_ACTIVE)
            self.pause_btn.config(text="Pause", state="disabled")
            try:
                wav, warning = self.recorder.stop()
            except Exception as e:
                self.rec_status.config(text="Recording error")
                messagebox.showerror("Recording failed", str(e))
                return
            if warning:
                self.log("Warning: " + warning)
            if wav is None:
                self.rec_status.config(text="No audio captured")
                self.log("No audio captured (was anything playing / mic muted?).")
                return
            self.last_wav = wav
            self.rec_status.config(text=f"Saved: {wav.name}")
            self.log_file("Recording saved (click to open): ", wav)
            self._refresh_history()
            self.process_btn.config(state="normal")

    # ---- token ------------------------------------------------------------
    def save_token(self):
        self.cfg["hf_token"] = self.token_var.get().strip()
        save_config(self.cfg)
        self.log("HuggingFace token saved.")

    # ---- auto-start -------------------------------------------------------
    def _toggle_autostart(self):
        state = set_autostart(self.autostart_var.get())
        self.autostart_var.set(state)   # reflect the real result
        self.log("Auto-start at login: " + ("ON" if state else "OFF"))

    # ---- processing -------------------------------------------------------
    def pick_file(self):
        path = filedialog.askopenfilename(
            title="Choose a WAV/MP4 file to transcribe",
            filetypes=[("Audio/Video", "*.wav *.mp4 *.m4a *.mp3 *.mkv *.mov"), ("All", "*.*")])
        if path:
            self.last_wav = Path(path)
            self.process_btn.config(state="normal")
            self.log_file("Selected (click to open): ", path)
            self.start_processing()   # transcription starts right after selecting

    def start_processing(self):
        if not self.last_wav or not Path(self.last_wav).exists():
            messagebox.showwarning("No file", "Record or choose a file first.")
            return
        self.process_btn.config(state="disabled")
        self.export_btn.config(state="disabled")
        token = self.token_var.get().strip()
        model = self.model_var.get()
        num = self.speakers_var.get().strip() or None
        wav = self.last_wav
        threading.Thread(target=self._process_worker,
                         args=(wav, model, token, num), daemon=True).start()

    def _process_worker(self, wav, model, token, num):
        try:
            segs = run_pipeline(Path(wav), model, token, num, self.log)
            self.msg_q.put(("done", segs))
        except Exception as e:
            self.msg_q.put(("error", f"{type(e).__name__}: {e}"))

    def _on_processing_done(self, segments):
        self.process_btn.config(state="normal")
        self.segments = segments
        if not segments:
            self.log("No speech found.")
            return
        # build rename fields for each detected speaker
        for w in self.rename_inner.winfo_children():
            w.destroy()
        self.speaker_name_vars = {}
        speakers = []
        for s in segments:
            if s["speaker"] not in speakers:
                speakers.append(s["speaker"])
        for i, spk in enumerate(speakers):
            ttk.Label(self.rename_inner, text=spk + " →").grid(row=i, column=0, sticky="e", padx=4, pady=3)
            var = tk.StringVar(value=spk)
            self.speaker_name_vars[spk] = var
            ttk.Entry(self.rename_inner, textvariable=var, width=28).grid(row=i, column=1, padx=4, pady=3)
        self.export_btn.config(state="normal")

        preview = render_transcript(segments, {k: k for k in self.speaker_name_vars})
        self.log("\n----- PREVIEW -----\n" + preview)

        # Auto-save immediately so a transcript always exists, even before renaming.
        self.current_transcript_path = self._transcript_path_for(self.last_wav)
        self._write_transcript({k: k for k in self.speaker_name_vars})
        self.log("")
        self.log_file("Transcript saved (click to open): ", self.current_transcript_path)
        self.log("(Rename speakers above and click 'Apply names & export' to update it.)")
        self._refresh_history()

    def _transcript_path_for(self, source) -> Path:
        """A transcript path named after the source recording (collision-guarded)."""
        stem = Path(source).stem if source else datetime.now().strftime("transcript_%Y-%m-%d_%H-%M-%S_%f")
        out = TRANSCRIPTS_DIR / f"{stem}.txt"
        counter = 1
        while out.exists():
            out = TRANSCRIPTS_DIR / f"{stem}_{counter}.txt"
            counter += 1
        return out

    def _write_transcript(self, name_map: dict) -> None:
        text = render_transcript(self.segments, name_map)
        self.current_transcript_path.write_text(text, encoding="utf-8")

    def export_txt(self):
        if not self.segments or self.current_transcript_path is None:
            return
        name_map = {k: v.get().strip() or k for k, v in self.speaker_name_vars.items()}
        self._write_transcript(name_map)   # update the same file with the names
        self.log("")
        self.log_file("Transcript updated with names (click to open): ",
                      self.current_transcript_path)
        self._refresh_history()
        messagebox.showinfo("Saved", f"Transcript saved to:\n{self.current_transcript_path}")

    def open_output(self):
        import os
        os.startfile(TRANSCRIPTS_DIR)


if __name__ == "__main__":
    import sys

    # Give the app its own taskbar identity so Windows shows OUR icon (the red "R")
    # rather than the generic pythonw icon, and groups it as its own app.
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    except Exception:
        pass

    # Only one session allowed. A second launch flashes the running window's
    # taskbar button and tells the user it's already open, then exits.
    if already_running():
        flash_existing_window()
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(
                0,
                "Audio Recorder is already running.\n\n"
                "Look for the flashing red \"R\" icon on your taskbar.",
                "Audio Recorder — already open",
                0x30)  # MB_ICONWARNING | MB_OK
        except Exception:
            pass
        sys.exit(0)

    App().mainloop()
