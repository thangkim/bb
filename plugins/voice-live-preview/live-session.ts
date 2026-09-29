import type {
  ExperimentalComposerVoiceRecording,
  ExperimentalComposerVoiceSession,
} from "@get-bb/plugin-sdk/app";
import {
  CLOUD_DRAFT_POLICY,
  LOCAL_DRAFT_POLICY,
  createDraftScheduler,
} from "./draft-scheduler.js";
import { describeVoiceError, runFinalTranscription } from "./transcription.js";

export interface LiveSessionToasts {
  warning(
    title: string,
    options: {
      description: string;
      duration: number;
      action: { label: string; onClick: () => void };
    },
  ): void;
}

export function downloadRecording(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function voiceCancelledError(): DOMException {
  return new DOMException("Voice transcription was cancelled", "AbortError");
}

export function startLiveVoiceSession(
  session: ExperimentalComposerVoiceSession,
  toasts: LiveSessionToasts,
): ExperimentalComposerVoiceRecording {
  const startedAtMs = Date.now();
  const scheduler = createDraftScheduler({
    policy: session.serviceRunsLocally
      ? LOCAL_DRAFT_POLICY
      : CLOUD_DRAFT_POLICY,
    now: () => Date.now(),
    recordedMs: () => Date.now() - startedAtMs,
    request: (signal) => {
      const recording = session.readRecording();
      return recording.size === 0
        ? Promise.resolve("")
        : session.transcribe(recording, { signal });
    },
    onDraft: (text) => session.provisionalText?.update(text),
  });
  scheduler.start(startedAtMs);
  session.signal.addEventListener("abort", () => scheduler.stop(), {
    once: true,
  });

  return {
    async finish(recording) {
      scheduler.halt();
      await scheduler.settled();
      const outcome = await runFinalTranscription({
        transcribe: (signal) => session.transcribe(recording, { signal }),
        signal: session.signal,
        lastDraft: scheduler.lastDraft,
      });
      switch (outcome.kind) {
        case "transcript":
          return outcome.text;
        case "cancelled":
          throw voiceCancelledError();
        case "fallback":
          toasts.warning("Voice input used the live preview", {
            description: describeVoiceError(outcome.error),
            duration: Infinity,
            action: {
              label: "Download recording",
              onClick: () => downloadRecording(recording),
            },
          });
          return outcome.text;
        case "failed":
          throw outcome.error;
      }
    },
  };
}
