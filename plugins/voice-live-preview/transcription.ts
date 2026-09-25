import { normalizeTranscript } from "./draft-scheduler.js";

export const FINAL_RETRY_DELAY_MS = 700;

export type TranscribeRequest = (signal: AbortSignal) => Promise<string>;

export type FinalTranscriptionOutcome =
  | { kind: "transcript"; text: string }
  | { kind: "cancelled" }
  | { kind: "fallback"; text: string; error: unknown }
  | { kind: "failed"; error: unknown };

const HTML_DOCUMENT_PATTERN = /<!doctype html|<html[\s>]/iu;

function waitBeforeRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function requestTranscript(
  transcribe: TranscribeRequest,
  signal: AbortSignal,
): Promise<string> {
  const text = normalizeTranscript(await transcribe(signal));
  if (text.length === 0) {
    throw new Error("Voice transcription returned an empty result.");
  }
  return text;
}

export async function runFinalTranscription({
  transcribe,
  signal,
  lastDraft,
}: {
  transcribe: TranscribeRequest;
  signal: AbortSignal;
  lastDraft: () => string;
}): Promise<FinalTranscriptionOutcome> {
  let error: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await waitBeforeRetry(FINAL_RETRY_DELAY_MS, signal);
    if (signal.aborted) return { kind: "cancelled" };
    try {
      return {
        kind: "transcript",
        text: await requestTranscript(transcribe, signal),
      };
    } catch (caught) {
      if (signal.aborted) return { kind: "cancelled" };
      error = caught;
    }
  }
  const draft = normalizeTranscript(lastDraft());
  return draft.length > 0
    ? { kind: "fallback", text: draft, error }
    : { kind: "failed", error };
}

function sanitizeErrorMessage(raw: string): string | null {
  let normalized = raw.replace(/\s+/gu, " ").trim();
  const htmlStart = normalized.search(HTML_DOCUMENT_PATTERN);
  if (htmlStart >= 0) normalized = normalized.slice(0, htmlStart).trim();
  normalized = normalized.replace(/^HTTP\s+\d{3}:\s*/iu, "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function describeVoiceError(
  error: unknown,
  hasPreferredAudioInput = false,
): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Microphone permission denied";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return hasPreferredAudioInput
          ? "Selected microphone was not found"
          : "No microphone was found";
      case "NotReadableError":
      case "TrackStartError":
        return "Microphone is already in use";
      case "AbortError":
        return "Voice capture was aborted";
      default:
        return "Failed to start voice recording";
    }
  }
  if (error instanceof Error) {
    const message = sanitizeErrorMessage(error.message);
    if (message !== null) return message;
  }
  return "Voice input failed";
}
