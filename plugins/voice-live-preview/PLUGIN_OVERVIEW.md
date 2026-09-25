Dictate into the prompt box and watch the words appear where you are typing, before you stop recording.

## What you get

- A **Start dictation** button in the thread, new-thread, and side-chat composers. It replaces bb's own microphone button in those composers.
- A live transcript painted in muted text at the cursor, or after the last character if you never placed the cursor. It is not part of the draft until you stop.
- On macOS, **⌃V** starts and stops dictation in the focused composer. Rebind it in Keyboard settings as **Voice: dictate into the composer**.

## How it works

While you speak, the recording so far is re-sent every few seconds for a draft transcript: the first after 3 seconds, then at growing intervals up to 8 seconds, at most 12 per recording and none after 3 minutes. A draft that fails or takes longer than 4 seconds stops drafts for the rest of the recording without an error.

When you stop, bb waits for any draft in flight, then transcribes the whole recording and inserts it at the preview's position as one undo step. A failed final transcription is retried once. If it still fails, the last draft is inserted and a warning offers **Download recording**; with no draft, an error offers the same download.

Transcription uses the voice service chosen in bb's AI settings and the microphone chosen in Voice input settings. The button is hidden when no voice service is available.

The plugin adds no agent tools or CLI commands.
