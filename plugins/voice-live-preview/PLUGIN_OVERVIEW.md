Watch your words appear where you are typing while you dictate with bb's microphone, before you stop recording.

## What you get

- A live transcript painted in muted text at the cursor, or after the last character if you never placed the cursor, while bb's own recording bar is showing. It is not part of the draft until you stop.
- The final transcript inserted at the same spot as one undo step.
- On macOS, **⌃V** starts and stops bb's microphone in the focused composer. Rebind it in Keyboard settings as **Voice: dictate into the composer**.

## How it works

bb's voice input works as before: the same microphone buttons, recording bar, Escape to cancel, and completion animation. While you speak, the plugin re-sends the recording so far for a draft transcript: the first after 3 seconds, then at growing intervals up to 8 seconds, at most 12 per recording and none after 3 minutes. A draft that fails or takes longer than 4 seconds stops drafts for the rest of the recording without an error.

When the voice service in Settings → AI services runs on your own machine (such as Local Whisper), drafts are free, so the plugin sends one a second from the first second, starting the next as soon as a slower one returns, for up to 10 minutes of recording. Each draft may take up to 8 seconds, and drafting stops only after three failures in a row.

When you stop, the plugin waits for any draft in flight, then transcribes the whole recording through bb. A failed final transcription is retried once. If it still fails, the last draft is inserted and a warning offers **Download recording**; with no draft, bb shows its usual error with the same download.

The plugin adds no agent tools or CLI commands.
