# Video Transcriber

Extracts audio from an MP4 (or any video ffmpeg reads) and writes a plain-text
transcript. Runs **fully offline** — no API keys, nothing leaves your machine.

## Usage

Drag an `.mp4` onto **`Transcribe video (drag video here).bat`**, or from a terminal:

```powershell
python transcribe.py "C:\path\to\video.mp4"
```

The transcript is saved as `video.txt` next to the source video.

### Options

| Option | Description |
|---|---|
| `--model` | `tiny`, `base` (default), `small`, `medium`, `large-v3`. Bigger = more accurate, slower. |
| `--language en` | Force a language instead of auto-detecting. |
| `--keep-audio` | Also keep the extracted `.wav`. |
| `-o out.txt` | Custom transcript path. |

Example — higher accuracy, English:

```powershell
python transcribe.py "meeting.mp4" --model small --language en
```

## Notes
- First run of each model size downloads it once (base ≈ 140 MB), then caches.
- Uses `ffmpeg` (already on PATH) for extraction and `faster-whisper` for speech-to-text.
- Runs on CPU. `base` transcribes roughly as fast as real time on a typical laptop;
  `small`/`medium` are more accurate but slower.
