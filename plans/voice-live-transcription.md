# Live Voice Transcription

## Goal

Show the words as they are spoken, punctuated, while the recording is still
running, and keep working when the speaker switches language mid-session
(English one day, Russian the next, or both inside one utterance).

Today voice input is silent until the recording stops. The speaker watches a
waveform, ends the recording, waits for a round trip, and only then finds out
whether the microphone picked up anything usable. A wrong word, a dropped
sentence, or a microphone that captured the wrong device is discovered after
the fact.

## Current State (2026-09-24)

The voice path is record-then-transcribe, one request per recording:

- `apps/app/src/hooks/useVoiceInput.ts` drives `MediaRecorder` with a 250 ms
  timeslice, accumulates blobs in `chunksRef`, and on `stop` posts the whole
  clip once. States are `idle | recording | transcribing | error`. Minimum
  recording length is 1 s.
- `apps/app/src/components/promptbox/usePromptVoice.ts` sends the clip through
  `transcribeVoiceInput` and inserts the returned string with
  `PromptBoxHandle.insertTextAtCursor`.
- `apps/app/src/components/promptbox/VoiceRecordingBar.tsx` replaces the action
  row while recording: cancel, waveform, confirm. No text surface exists.
- `apps/app/src/components/promptbox/PromptBoxInternal.tsx` holds a TipTap
  editor. `insertTextAtCursor` collapses whitespace and inserts once, at the
  cursor. There is no notion of provisional text.
- `apps/server/src/routes/system.ts` exposes `POST` voice-transcription as
  multipart (`file`, optional `prompt`), capped at 25 MB in
  `apps/server/src/services/ai/voice-transcription.ts`.
- Transcription is a plugin-contributed AI service. The contract in
  `packages/plugin-sdk/src/backend-contract.ts` is a single call:
  `transcribe(audio: File, { signal, hint }) => Promise<string>`, with a 10 s
  budget. There is no streaming shape and no language field.
- The only implementation is `plugins/provider-codex/src/ai-service.ts`, which
  posts the clip to `https://chatgpt.com/backend-api/transcribe` or
  `https://api.openai.com/v1/audio/transcriptions` with model `gpt-transcribe`
  (`plugins/provider-codex/src/ai/chatgpt-client.ts`).
- No `language` parameter is sent anywhere, so the model already detects the
  language per request. Nothing pins the transcript to English.
- Settings expose a microphone picker only
  (`apps/app/src/components/settings/VoiceInputSettingsSection.tsx`).
- The server already runs websockets through Hono
  (`createNodeWebSocket` / `upgradeWebSocket` in `apps/server/src/server.ts`,
  routes `/ws`, `/ws/terminals/:terminalId`, `/internal/ws`), so a streaming
  voice route needs no new transport layer.

Two gaps, not one: no incremental transcript, and no way for a service to
report one even if it had it.

## Behaviour

While recording, the prompt box shows the transcript building up in place of
the waveform-only bar. Text that the service has settled reads as normal
prompt text. Text still subject to revision reads muted. Each settled segment
arrives punctuated and capitalized, from the service, not from local
post-processing.

Stopping the recording promotes every provisional word to settled text and
leaves the caret after it, which is where `insertTextAtCursor` leaves it today.
Cancelling discards everything, including settled segments, and restores the
prompt to its pre-recording value.

Language is never asked for up front. The default is automatic detection per
segment, which is what the model does already. A speaker who starts in English
and finishes in Russian gets each segment in the script it was spoken in. The
recording bar names the detected language once detection settles, so a wrong
detection is visible before the text is sent rather than after.

A speaker who works in one language and is tired of detection errors can pin
the language in Settings. Pinning is an accuracy aid, not a requirement.

## Two Ways To Get Partial Text

### Option A: rolling re-transcription (no contract change)

The client already accumulates 250 ms chunks. Every ~2 s it can post the
accumulated audio from the start of the recording as a draft request, and show
the result as provisional text. The whole clip is sent each time, so the file
is always a valid container and language detection sees the full context.

- Ships against the existing `transcribe` contract and the existing route.
- Works with any service that can transcribe at all, including Codex today.
- Upload volume grows with the square of the recording length. Acceptable for
  utterances under a minute, wasteful past that.
- Latency to first words is roughly one request, about 1 s.
- Punctuation quality equals the final result, because it is the same call.

### Option B: streaming transcription (contract change)

A new optional service method returns an event stream instead of a string, and
the browser sends audio up a websocket as it is captured.

- Words appear within a few hundred milliseconds.
- Audio is uploaded once.
- Requires a plugin SDK addition, a server websocket route, PCM capture in the
  renderer through an `AudioWorklet` rather than `MediaRecorder`, and a Codex
  implementation against the realtime transcription socket.
- Services that do not implement it keep today's behaviour.

### Recommendation

Build A first and keep it as the permanent fallback, then add B behind the same
UI. A proves the interface work (provisional text in a TipTap document, commit
and discard, language display) without touching the plugin contract, and it is
the only path available to a service that cannot stream. B then replaces the
event source, not the interface.

## Contract

### Streaming service method (Phase 2)

Added to `PluginAiServiceDeclaration`, optional, alongside `transcribe`:

```ts
interface PluginAiTranscribeStreamOptions {
  readonly signal: AbortSignal;
  readonly hint: string | null;
  /** BCP-47 tag when the user pinned a language; null means detect. */
  readonly language: string | null;
}

type PluginTranscriptEvent =
  | { readonly type: "partial"; readonly text: string }
  | {
      readonly type: "settled";
      readonly text: string;
      /** BCP-47 tag the service detected, when it reports one. */
      readonly language: string | null;
    };

readonly transcribeStream?: (
  audio: AsyncIterable<Uint8Array>,
  options: PluginAiTranscribeStreamOptions,
) => AsyncIterable<PluginTranscriptEvent>;
```

`partial` replaces the current provisional tail. `settled` appends and clears
the tail. A service that cannot separate the two emits `settled` only.

`aiServiceTasks` and `aiServiceSupportsTask`
(`apps/server/src/services/ai/ai-service-registry.ts`) treat `transcribeStream`
as satisfying the `voice` task on its own, so a streaming-only service still
appears in the picker.

### Language on the existing method

`PluginAiTranscribeOptions` gains `language: string | null`, and the voice
route accepts an optional `language` form field. Codex forwards it as the
`language` form field, which the transcription endpoint accepts, and omits it
when null so detection stays automatic.

### Transport (Phase 2)

`GET /ws/voice-transcription`, guarded by the same
`assertBrowserWebSocketAllowed` check the other browser sockets use. The client
sends a JSON open frame (`hint`, `language`), then binary PCM16 frames at
24 kHz mono. The server sends JSON frames mirroring `PluginTranscriptEvent`,
plus a terminal `{ type: "error", message }` or `{ type: "done" }`.

## Phases

### Phase 1: provisional text, rolling drafts (shipped 2026-09-24)

1. `useVoiceInput` takes an optional `onDraftTranscribe` and runs a draft loop
   while recording. Each draft is scheduled after the previous one settles, so
   requests never overlap, and the interval backs off from 2 s by 1.4x to a
   ceiling of 8 s: responsive at the start of an utterance, cheap through a
   long one. Caps are 20 requests and 3 minutes. One failed draft ends the loop
   for the rest of the recording; the recording continues without live text.
2. A failed draft is silent. It raises no toast, and the final transcription
   runs regardless. The route accepts a `draft` form field, which gives the AI
   task a 4 s budget instead of 10 s, because a late draft has already been
   overtaken by the next one.
3. The live text renders as a muted overlay across the prompt box input
   region, wrapping and scrolling to the newest line, so a long utterance uses
   the whole composer area instead of one truncated line. The waveform keeps
   the action row. The text is not inserted into the prompt document while
   recording: the editor is entered once, on stop, exactly as before, so undo
   history, mentions and decorations are untouched. Putting provisional text
   inside the TipTap document is deferred until there is a reason to edit it
   mid-recording.
4. The final transcription on stop remains the single source of the sent text.
   Draft output is never promoted; it is replaced and cleared. A failed final
   is retried once after 700 ms, because the draft loop can leave the upstream
   service rate limiting the request that actually matters.

Touched: `apps/app/src/hooks/useVoiceInput.ts`,
`apps/app/src/components/promptbox/usePromptVoice.ts`,
`apps/app/src/components/promptbox/VoiceRecordingBar.tsx`,
`apps/app/src/components/promptbox/PromptBoxInternal.tsx`,
`apps/app/src/lib/api.ts`, `apps/server/src/routes/system.ts`,
`apps/server/src/services/ai/voice-transcription.ts`.

### Phase 2: streaming

1. Add `transcribeStream`, `language`, and the event type to the plugin SDK,
   with the host policy entry that gates it
   (`packages/plugin-sdk/src/internal/host-policy.ts`).
2. Add the websocket route and a server-side session that pumps audio into the
   selected service and events back out.
3. Capture PCM in the renderer through an `AudioWorklet`. Keep `MediaRecorder`
   running in parallel so the clip is still available for the fallback path and
   for the download-on-failure action.
4. Implement `transcribeStream` in `provider-codex` against the realtime
   transcription socket with server-side turn detection, language left unset
   when the user has not pinned one.
5. Selection at record time: use `transcribeStream` when the selected service
   declares it, otherwise run Phase 1's draft loop.

Done when: words appear under 500 ms after they are spoken with Codex
selected, and a service without `transcribeStream` behaves exactly as after
Phase 1.

### Phase 3: language handling

The transcription endpoint takes one language or none. It has no parameter for
a candidate set, so a shortlist cannot be pushed down into the model. What a
shortlist can do is sit above it, as a guard and as a one-tap correction.

1. Settings gains "Spoken languages", a set rather than a single choice,
   defaulting to every language. A speaker who selects English, Russian and
   Vietnamese is describing the set bb is allowed to land on, not a request to
   the model.
2. Each settled transcript is classified locally by script: Cyrillic is
   Russian, Latin carrying Vietnamese tone marks is Vietnamese, plain Latin is
   English. For a set separated this cleanly, the classifier is more reliable
   than any metadata the endpoint currently returns, and it costs nothing. The
   current code sends no `response_format` and reads only `text`
   (`plugins/provider-codex/src/ai/chatgpt-client.ts`), so no detected language
   is available today.
3. When a settled transcript classifies outside the selected set, treat it as a
   detection error rather than a result: re-run that segment once with
   `language` pinned to the in-set language whose script the audio best matches,
   or to the last language used in this recording when the script is
   ambiguous. Out-of-set output is the only trigger, so the extra call is rare.
4. Within one recording, the first settled segment pins the language for the
   draft requests that follow it, so the provisional text stops flipping script
   between drafts. The pin is dropped at the end of the recording, never
   remembered across recordings.
5. The recording bar names the current language and lets it be changed from the
   selected set in one tap. Correcting it re-runs the recording so far with
   that language pinned.
6. The prompt-context hint is dropped when its script does not match the
   current language, because a hint in one script pulls transcription in
   another toward transliteration.

## Risks

- **Cost and rate limits — confirmed, not hypothetical.** First live run,
  2026-09-24: nine drafts returned 200 in about 20 s, then the *final*
  transcription came back `HTTP 403: chatgpt.com answered with a Cloudflare
  challenge`. It happened on two consecutive recordings, the same way both
  times. The draft loop spends the quota and the one request the speaker cares
  about pays for it. Mitigated by the backoff, the lower cap, the one-strike
  rule and the retry; removed properly by Phase 2, which uploads audio once.
- **Flicker.** Provisional text that rewrites itself every two seconds is
  distracting. Only the tail after the last settled segment is allowed to
  change; settled text never rewrites.
- **Hint bias across scripts.** Already a live problem in the current
  implementation: a prompt written in English biases Russian speech toward
  English spelling. Phase 3 addresses it.
- **Container validity.** Draft requests must always send the accumulated blob
  from the first chunk. A `MediaRecorder` slice on its own is not a decodable
  file.
- **Undo history.** Provisional updates must not land as individual undo steps
  in the prompt editor.
- **Pinning versus code-switching.** A pinned language transcribes the whole
  utterance in that language, so an English technical term inside a Russian
  sentence comes back transliterated. Pinning is therefore per-recording and
  never sticky, and automatic stays the default.

## Open Questions

- Whether a settled segment should be editable before the recording stops, or
  stay read-only until the recording ends.
- Whether Codex's ChatGPT-backed auth grants realtime transcription, or whether
  Phase 2 only applies to API-key auth. This decides whether Phase 1 is a
  stepping stone or the permanent path for most users.
- Whether the detected language belongs anywhere outside the recording bar, for
  example on the sent message.
- How often detection actually lands outside a three-language set in practice.
  The guard in Phase 3 is cheap, but its value is unmeasured. Worth logging
  out-of-set detections before building the re-run path.
