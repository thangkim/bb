Dictate into bb with a free, open-source Whisper model running on your own Mac. Local Whisper reuses what OpenWhispr already installed — its whisper.cpp server, ffmpeg, and the models you downloaded — so there is nothing else to set up.

## What you get

- A **Local Whisper** choice under Settings → AI services → Voice input.
- Transcription on the primary machine: no audio leaves it and no account or API key is needed.
- Language detection limited to the languages you speak (English, Russian, and Vietnamese by default), sentence by sentence, so you can switch languages mid-dictation.
- A warm model: it preloads and stays in memory for an hour after you last dictate. With Voice live preview, drafts arrive about every second, including right after you switch languages.
- A small second model (Whisper base, reused from OpenWhispr or downloaded once, about 148 MB) that tells your languages apart quickly.

## Requirements

- macOS with OpenWhispr installed and a multilingual model downloaded (Turbo recommended), or `whisper-server` and `ffmpeg` from Homebrew plus a ggml model file.
- About 2 GB of free memory while the Turbo model is loaded, plus about 200 MB for the language model.

Run `bb local-whisper status` to see what the plugin found.
