Dictate into the composer with the plugin's own microphone button and watch a live transcript of your words above the composer before you stop recording.

## What you get

- A **Start dictation** mic button in each composer's action row, in place of bb's own microphone button, which the plugin hides in every composer where its button is showing.
- While you record, the button turns into **Cancel** (×) and **Stop and insert** (✓) buttons with a pulsing red dot, and a card above the composer shows **Listening…** with the latest draft transcript in muted text, plus **Insert** and **Cancel** buttons. Your words are not part of the draft until you stop.
- The final transcript is inserted at the cursor as one undo step, with a space added on either side where it would otherwise run into a neighbouring word. If the composer is no longer on screen, it is appended to the end of that composer's draft.
- **Escape** cancels a recording or a transcription in progress.
- On macOS, **⌃V** starts and stops the plugin's microphone in the composer holding the caret, or in the focused pane's composer. Rebind it in Keyboard settings as **Voice: dictate into the composer**.

## How it works

The plugin records with its own browser microphone access. It uses the microphone chosen in bb's voice preferences, or the default microphone when that one is missing, and keeps the screen awake while recording. Every transcription, including the drafts, goes through bb's voice transcription with the voice service selected in Settings → AI services → Voice input. The current draft text is sent along as context.

While you speak, the plugin re-sends the recording so far for a draft transcript: the first after 3 seconds, then at growing intervals up to 8 seconds, at most 12 per recording and none after 3 minutes. A draft that fails or takes longer than 4 seconds stops drafts for the rest of the recording without an error.

When that voice service runs on your own machine (Local Whisper by default; change the list in the plugin's **Voice services that run on this machine** setting), drafts are free. The plugin then sends one a second from the first second, starting the next as soon as a slower one returns, for up to 10 minutes of recording. Each draft may take up to 8 seconds, and drafting stops only after three failures in a row.

When you stop, the plugin waits for any draft in flight, then transcribes the whole recording. A failed final transcription is retried once. If it still fails, the last draft is inserted and a warning offers **Download recording**. With no draft, an error shows with the same download. Recordings shorter than one second are discarded.

If you leave a composer while it is recording, the plugin stops the recording after a moment and appends the transcript to that composer's draft.

## Limits

- In the collapsed single-line composer layout, bb shows no plugin action buttons, so bb's own microphone stays visible there and dictates without the live draft. **⌃V** still uses the plugin's microphone and shows the live draft card.
- The plugin hides bb's microphone button by matching its accessible label and description. If a bb update renames them, both buttons may show until the plugin is updated.

The plugin adds no agent tools or CLI commands. Change its setting with `bb plugin config voice-live-preview set localVoiceServices <plugin-id/service-id,...>`.
