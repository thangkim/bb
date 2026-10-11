import {
  CLOUD_DRAFT_POLICY,
  createDraftScheduler,
  type DraftPolicy,
  type DraftScheduler,
} from "./draft-scheduler.js";
import { describeVoiceError, runFinalTranscription } from "./transcription.js";

export const MIN_RECORDING_MS = 1_000;

export type VoicePhase = "idle" | "starting" | "recording" | "transcribing";

export interface VoiceSessionState {
  readonly phase: VoicePhase;
  readonly draft: string;
}

export interface VoiceTarget {
  promptContext(): string | undefined;
  insert(text: string): void;
}

export interface VoiceRecording {
  readonly startedAtMs: number;
  snapshot(): File;
  stop(): Promise<File>;
  cancel(): void;
}

export interface VoiceToastOptions {
  description?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export interface VoiceNotifier {
  error(title: string, options?: VoiceToastOptions): void;
  warning(title: string, options?: VoiceToastOptions): void;
}

export interface VoiceSessionDeps {
  startRecording(onFailure: (error: unknown) => void): Promise<VoiceRecording>;
  transcribe(
    audio: Blob,
    prompt: string | undefined,
    signal: AbortSignal,
  ): Promise<string>;
  draftPolicy(): Promise<DraftPolicy>;
  download(file: File): void;
  notify: VoiceNotifier;
  now(): number;
}

export interface VoiceSession {
  getState(): VoiceSessionState;
  subscribe(listener: () => void): () => void;
  start(target: VoiceTarget): Promise<void>;
  stop(): Promise<void>;
  cancel(): boolean;
  toggle(target: VoiceTarget): Promise<void>;
  dispose(): void;
}

interface ActiveRecording {
  readonly recording: VoiceRecording;
  readonly target: VoiceTarget;
  readonly prompt: string | undefined;
  readonly controller: AbortController;
  scheduler: DraftScheduler | null;
}

const IDLE: VoiceSessionState = { phase: "idle", draft: "" };

export function createVoiceSession(deps: VoiceSessionDeps): VoiceSession {
  const listeners = new Set<() => void>();
  let state: VoiceSessionState = IDLE;
  let generation = 0;
  let active: ActiveRecording | null = null;

  const setState = (next: VoiceSessionState) => {
    if (next.phase === state.phase && next.draft === state.draft) return;
    state = next;
    for (const listener of listeners) listener();
  };

  const release = (session: ActiveRecording) => {
    if (active !== session) return;
    active = null;
    session.scheduler?.stop();
    session.recording.cancel();
    setState(IDLE);
  };

  const downloadAction = (file: File) => ({
    label: "Download recording",
    onClick: () => deps.download(file),
  });

  const deliver = (target: VoiceTarget, text: string, file: File): boolean => {
    try {
      target.insert(text);
      return true;
    } catch (error) {
      deps.notify.error("Couldn't insert the transcript", {
        description: `${describeVoiceError(error)}: ${text}`,
        duration: Infinity,
        action: downloadAction(file),
      });
      return false;
    }
  };

  const failRecording = (session: ActiveRecording, error: unknown) => {
    if (active !== session) return;
    const draft = session.scheduler?.lastDraft() ?? "";
    const file = session.recording.snapshot();
    release(session);
    if (draft.length > 0 && deliver(session.target, draft, file)) {
      deps.notify.warning("Voice input used the live preview", {
        description: describeVoiceError(error),
        duration: Infinity,
        action: downloadAction(file),
      });
      return;
    }
    deps.notify.error("Voice input failed", {
      description: describeVoiceError(error),
    });
  };

  const startDrafts = (session: ActiveRecording) => {
    void deps
      .draftPolicy()
      .catch(() => CLOUD_DRAFT_POLICY)
      .then((policy) => {
        if (active !== session || state.phase !== "recording") return;
        const { recording, prompt } = session;
        const scheduler = createDraftScheduler({
          policy,
          now: deps.now,
          recordedMs: () => deps.now() - recording.startedAtMs,
          request: (signal) => {
            const audio = recording.snapshot();
            return audio.size === 0
              ? Promise.resolve("")
              : deps.transcribe(audio, prompt, signal);
          },
          onDraft: (draft) => {
            if (active === session) setState({ phase: state.phase, draft });
          },
        });
        session.scheduler = scheduler;
        scheduler.start(recording.startedAtMs);
      });
  };

  const start = async (target: VoiceTarget): Promise<void> => {
    if (state.phase !== "idle") return;
    generation += 1;
    const run = generation;
    setState({ phase: "starting", draft: "" });
    let recording: VoiceRecording;
    try {
      recording = await deps.startRecording((error) => {
        if (active?.recording === recording) failRecording(active, error);
      });
    } catch (error) {
      if (run !== generation) return;
      setState(IDLE);
      deps.notify.error("Voice input failed", {
        description: describeVoiceError(error),
      });
      return;
    }
    if (run !== generation) {
      recording.cancel();
      return;
    }
    const session: ActiveRecording = {
      recording,
      target,
      prompt: readPrompt(target),
      controller: new AbortController(),
      scheduler: null,
    };
    active = session;
    setState({ phase: "recording", draft: "" });
    startDrafts(session);
  };

  const stop = async (): Promise<void> => {
    const session = active;
    if (session === null || state.phase !== "recording") return;
    setState({ phase: "transcribing", draft: state.draft });
    session.scheduler?.halt();
    let file: File;
    try {
      file = await session.recording.stop();
    } catch (error) {
      failRecording(session, error);
      return;
    }
    if (active !== session) return;
    if (deps.now() - session.recording.startedAtMs < MIN_RECORDING_MS) {
      release(session);
      deps.notify.error("Recording too short (minimum 1 second)");
      return;
    }
    if (file.size === 0) {
      release(session);
      deps.notify.error("No audio was captured");
      return;
    }
    await session.scheduler?.settled();
    if (active !== session) return;
    const outcome = await runFinalTranscription({
      transcribe: (signal) => deps.transcribe(file, session.prompt, signal),
      signal: session.controller.signal,
      lastDraft: () => session.scheduler?.lastDraft() ?? "",
    });
    if (active !== session) return;
    release(session);
    switch (outcome.kind) {
      case "transcript":
        deliver(session.target, outcome.text, file);
        return;
      case "fallback":
        if (deliver(session.target, outcome.text, file)) {
          deps.notify.warning("Voice input used the live preview", {
            description: describeVoiceError(outcome.error),
            duration: Infinity,
            action: downloadAction(file),
          });
        }
        return;
      case "failed":
        deps.notify.error("Voice input failed", {
          description: describeVoiceError(outcome.error),
          duration: Infinity,
          action: downloadAction(file),
        });
        return;
      case "cancelled":
        return;
    }
  };

  const cancel = (): boolean => {
    if (state.phase === "idle") return false;
    generation += 1;
    const session = active;
    if (session === null) {
      setState(IDLE);
      return true;
    }
    session.controller.abort();
    release(session);
    return true;
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    stop,
    cancel,
    async toggle(target) {
      switch (state.phase) {
        case "idle":
          return start(target);
        case "starting":
          cancel();
          return;
        case "recording":
          return stop();
        case "transcribing":
          return;
      }
    },
    dispose() {
      cancel();
      listeners.clear();
    },
  };
}

function readPrompt(target: VoiceTarget): string | undefined {
  try {
    const prompt = target.promptContext()?.trim();
    return prompt === undefined || prompt.length === 0 ? undefined : prompt;
  } catch {
    return undefined;
  }
}
