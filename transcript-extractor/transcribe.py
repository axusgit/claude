#!/usr/bin/env python3
"""
Extract audio from an MP4 (or other video) and write a plain-text transcript.

Usage:
    python transcribe.py <video.mp4> [--model base] [--language en] [--keep-audio]

Output:
    <video>.txt          the transcript, next to the source video
    (optional) <video>.wav if --keep-audio is passed
"""
import argparse
import subprocess
import sys
import tempfile
from pathlib import Path


def extract_audio(video_path: Path, wav_path: Path) -> None:
    """Pull a 16 kHz mono WAV out of the video with ffmpeg."""
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-vn",                 # drop video
        "-ac", "1",            # mono
        "-ar", "16000",        # 16 kHz — what Whisper expects
        "-c:a", "pcm_s16le",   # uncompressed PCM
        str(wav_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"ffmpeg failed:\n{result.stderr}")


def transcribe(wav_path: Path, model_size: str, language: str | None) -> str:
    """Run faster-whisper and return the full transcript text."""
    from faster_whisper import WhisperModel

    print(f"Loading model '{model_size}' (first run downloads it)...", flush=True)
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    print("Transcribing...", flush=True)
    segments, info = model.transcribe(
        str(wav_path),
        language=language,
        vad_filter=True,   # skip silence
    )
    print(f"Detected language: {info.language} "
          f"(probability {info.language_probability:.0%})", flush=True)

    lines = []
    for seg in segments:
        text = seg.text.strip()
        if text:
            lines.append(text)
            # live progress with timestamps
            print(f"[{seg.start:6.1f}s] {text}", flush=True)
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract audio from a video and produce a .txt transcript."
    )
    parser.add_argument("video", type=Path, help="Path to the .mp4 (or other) video")
    parser.add_argument("--model", default="base",
                        help="Whisper model: tiny, base, small, medium, large-v3 "
                             "(bigger = more accurate but slower). Default: base")
    parser.add_argument("--language", default=None,
                        help="Force a language code (e.g. en). Default: auto-detect")
    parser.add_argument("--keep-audio", action="store_true",
                        help="Keep the extracted .wav next to the video")
    parser.add_argument("-o", "--output", type=Path, default=None,
                        help="Transcript output path. Default: <video>.txt")
    args = parser.parse_args()

    video_path: Path = args.video
    if not video_path.exists():
        sys.exit(f"Video not found: {video_path}")

    out_path: Path = args.output or video_path.with_suffix(".txt")

    if args.keep_audio:
        wav_path = video_path.with_suffix(".wav")
        _cleanup = None
    else:
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.close()
        wav_path = Path(tmp.name)
        _cleanup = wav_path

    try:
        print(f"Extracting audio from {video_path.name}...", flush=True)
        extract_audio(video_path, wav_path)

        transcript = transcribe(wav_path, args.model, args.language)

        out_path.write_text(transcript, encoding="utf-8")
        print(f"\nTranscript written to: {out_path}", flush=True)
        if args.keep_audio:
            print(f"Audio kept at: {wav_path}", flush=True)
    finally:
        if _cleanup is not None and _cleanup.exists():
            _cleanup.unlink()


if __name__ == "__main__":
    main()
