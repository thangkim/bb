---
name: local-whisper
description: Transcribe bb voice input on the primary machine with whisper.cpp, reusing OpenWhispr's whisper-server, ffmpeg, and downloaded models; check readiness, transcribe audio files, and configure languages, model, and memory use.
---

Local Whisper registers the `local-whisper` voice service. It transcribes on the primary machine with whisper.cpp's `whisper-server`, so no audio leaves the machine and no account is needed. Select it in Settings → AI services → Voice input, or with the CLI:

```sh
bb settings ai-services set voice local-whisper
bb settings ai-services set voice automatic
```

Automatic never picks Local Whisper, so select it explicitly.

## What it uses

Each setting left empty is found automatically, in this order:

| Piece            | Search order                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `whisper-server` | `PATH`, `/opt/homebrew/bin`, `/usr/local/bin`, then `OpenWhispr.app/Contents/Resources/bin`                   |
| `ffmpeg`         | `PATH`, `/opt/homebrew/bin`, `/usr/local/bin`, then OpenWhispr's bundled `ffmpeg-static`                      |
| Model            | `~/.cache/openwhispr/whisper-models`: large-v3-turbo, its q8_0 and q5_0 builds, large-v3, medium, small, base |

| Language model | `~/.cache/openwhispr/whisper-models`: base, base q8_0, small, small q8_0; then `ggml-base.bin` in the plugin's data directory, downloaded once (about 148 MB) when `downloadLanguageModel` is on |

English-only `.en` models are skipped because they cannot transcribe other languages. The language model only tells your languages apart; without it, the main model does that too and live drafts slow down at each new sentence. Download a model in OpenWhispr (OpenAI → Turbo) or run `brew install whisper-cpp ffmpeg` and point `modelPath` at a ggml model.

## Commands

```sh
bb local-whisper status [--json]
bb local-whisper transcribe <file> [--language vi] [--json]
```

`status` prints the binaries and model in use, whether the model is loaded, and the configured languages; it exits 1 when something is missing and never loads the model. `transcribe` sends an audio file (webm, wav, mp3, m4a, ogg) through the same path as voice input and prints the text, the language used, and the elapsed time; the first call after the model unloads includes loading it.

## Settings

Change settings in Settings → Installed plugins → Local Whisper or with `bb plugin config local-whisper set <key> <value>`.

| Key                 | Default    | Meaning                                                                                             |
| ------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `languages`         | `en,ru,vi` | Languages you speak. Detection chooses among them; one code forces it; empty allows every language. |
| `preload`           | `true`     | Load the model in the background when bb checks voice availability, so the first dictation is warm. |
| `keepLoadedMinutes` | `60`       | Minutes the model stays loaded after the last use. Turbo holds about 2 GB of memory while loaded.   |
| `modelPath`         | empty      | Absolute path to a ggml model.                                                                      |
| `serverPath`        | empty      | Absolute path to `whisper-server`.                                                                  |
| `ffmpegPath`        | empty      | Absolute path to `ffmpeg`.                                                                          |

## Behavior

- The plugin runs its own `whisper-server` on a random localhost port. It does not use or stop the server OpenWhispr runs.
- Recordings are split at pauses of 0.4 seconds or longer. Each piece's language is identified on its own, and consecutive pieces in the same language are transcribed together (up to 25 seconds) in that language, so switching languages mid-dictation keeps every sentence as spoken. Blips under 0.3 seconds join the following piece.
- A piece with a second or more of speech is identified by the small language model. Under a second, the language model is trusted when it is at least 90% sure; otherwise the main model decides. Pieces under 0.4 seconds keep the previous piece's language. Speech identified as an unlisted language uses the likeliest listed one.
- A piece's language is remembered by the recording and its position, and finished spans are cached for 10 minutes, so each live draft identifies only new pieces and transcribes only the span being spoken. Drafts take about a second; the final transcript after live drafts usually takes one to two seconds.
- Without earlier drafts, identification stops after 5 seconds and the remaining pieces keep the last language, so a long cold recording can lose language switches after that point.
- The service declares `runsLocally`, so the Voice live preview plugin drafts about every second.
- Every request sends the same fields, because `whisper-server` keeps request options from one request to the next.
- bb stops waiting for a transcript after 10 seconds. Loading turbo from a cold disk can take longer, so a first request can fail while the model keeps loading; the next one succeeds.
- The model unloads after `keepLoadedMinutes` without use, when the plugin is disabled or reloaded, and when bb stops.
