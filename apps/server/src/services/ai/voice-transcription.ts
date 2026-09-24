import type { LoggedWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { isAiTaskAvailable, runAiTask } from "./ai-tasks.js";

interface TranscribeVoiceInputArgs {
  file: File;
  prompt?: string;
  draft?: boolean;
  signal: AbortSignal;
}

const VOICE_TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024;
const VOICE_TRANSCRIPTION_DRAFT_TIMEOUT_MS = 4_000;
const VOICE_TRANSCRIPTION_RETRY_DELAY_MS = 700;

export function resolveVoiceTranscriptionEnabled(
  deps: LoggedWorkSessionDeps,
): boolean {
  return isAiTaskAvailable(deps, "voice");
}

function trimPrompt(prompt: string | undefined): string | null {
  const trimmed = prompt?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function waitBeforeRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function transcribeVoiceInput(
  deps: LoggedWorkSessionDeps,
  args: TranscribeVoiceInputArgs,
): Promise<string> {
  if (args.file.size === 0) {
    throw new ApiError(400, "invalid_request", "Audio file must not be empty");
  }
  if (args.file.size > VOICE_TRANSCRIPTION_MAX_BYTES) {
    throw new ApiError(400, "invalid_request", "Audio file exceeds 25MB limit");
  }

  const hint = trimPrompt(args.prompt);
  const isDraft = args.draft === true;
  const run = () =>
    runAiTask(deps, {
      task: "voice",
      label: isDraft ? "Voice transcription draft" : "Voice transcription",
      logContext: isDraft ? { draft: true } : undefined,
      timeoutMs: isDraft ? VOICE_TRANSCRIPTION_DRAFT_TIMEOUT_MS : undefined,
      signal: args.signal,
      call: (service, signal) => {
        if (service.transcribe === null) {
          throw new Error("This service does not transcribe audio");
        }
        return service.transcribe(args.file, { signal, hint });
      },
      accept: (raw) => (typeof raw === "string" ? raw.trim() : null),
    });

  let outcome = await run();
  if (
    !outcome.ok &&
    outcome.reason === "failed" &&
    !isDraft &&
    !args.signal.aborted
  ) {
    await waitBeforeRetry(VOICE_TRANSCRIPTION_RETRY_DELAY_MS, args.signal);
    if (!args.signal.aborted) {
      outcome = await run();
    }
  }
  if (outcome.ok) {
    return outcome.value;
  }
  switch (outcome.reason) {
    case "off":
    case "unavailable":
      throw new ApiError(501, "not_configured", outcome.message);
    case "timeout":
      throw new ApiError(
        504,
        "transcription_timeout",
        "Voice transcription timed out",
        true,
      );
    case "failed":
      throw new ApiError(502, "provider_rpc_error", outcome.message);
    case "cancelled":
      throw new ApiError(400, "cancelled", "Voice transcription was cancelled");
  }
}
