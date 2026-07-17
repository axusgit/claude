# Audio Recorder + Diarized Transcript

A desktop app that:

1. **Records the whole conversation** — both the computer's own audio (system/loopback:
   the far end of a call, a video, a webinar) **and your microphone**, mixed into one
   file. The mic can be turned off with the checkbox to capture system audio only.
2. **Transcribes** it with faster-whisper.
3. **Separates speakers** with pyannote.audio and labels each segment
   `Speaker 1`, `Speaker 2`, … You then **rename** them once (e.g. Speaker 1 → "Andy")
   and export a `.txt` transcript.

Everything runs locally on your machine.

## Running it

Double-click **`Launch Audio Recorder.vbs`** — it opens the GUI with **no console
window**. (Under the hood it runs the app with `pythonw.exe`.)

The app has a **red bold "R"** taskbar/title-bar icon so it's easy to spot.

**Only one session can run at a time.** If you try to open it while it's already
running, a dialog says so and the existing window's taskbar button **flashes** so you
can find it.

To run with a visible console for debugging:

```powershell
python "C:\Users\Andy\UsersAndyaxus-claude\Audio Recorder\app.py"
```

## One-time setup: HuggingFace token (needed for speaker names)

pyannote's speaker model is free but "gated" — you accept a license and use a token.

1. Create a free account at https://huggingface.co/join
2. Accept the license on **both** model pages (click "Agree"):
   - https://huggingface.co/pyannote/speaker-diarization-3.1
   - https://huggingface.co/pyannote/segmentation-3.0
3. Create a token (Read scope): https://huggingface.co/settings/tokens
4. Paste the token into the app's **HuggingFace token** field and click **Save token**.

Without a token the app still records and transcribes — it just won't label speakers.

## Choosing a microphone

Section 1 has a **microphone dropdown** showing **one clean entry per physical mic**
(a **Refresh** button re-scans for newly plugged-in devices). Windows normally lists
each mic several times through different sound back-ends; the app collapses those into
a single row, picks a reliable back-end under the hood, and hides low-level/virtual
devices. Your choice is **remembered for the next recording and the next time you open
the app** (saved in `config.json`). If a selected device can't be opened, the app
automatically falls back to your default mic so your voice is still captured.

## How to use

1. Pick your **microphone** (and leave "Record my mic" checked for a full conversation).
2. Click **Start Recording**. Use **Pause/Resume** to skip parts — paused time is
   dropped, so the recording stitches together with no silent gap. Click
   **Stop Recording** and the WAV is saved to `recordings\` immediately.
3. Click **Transcribe last recording**. (First run downloads the models.) As soon as
   it finishes, a transcript is **saved automatically** to `transcripts\`, named after
   the recording (e.g. `recording_2026-07-17_09-00-51_507.txt`).
4. Detected speakers appear in section 4 — type real names next to each.
5. Click **Apply names & export .txt** to update that same file with the names.
   (The **Open output folder** button jumps straight to the transcripts folder.)

Outputs:
- Recordings → `recordings\`
- Transcripts → `transcripts\`

## Notes
- Speaker separation ("diarization") groups voices; it can't magically know names,
  so you assign them once per recording. Set **# Speakers** if you know the count —
  it improves accuracy.
- Accuracy dropdown: `base` is fast; `small`/`medium` are more accurate but slower.
- Runs on CPU. Diarization is the slow step on long recordings.
