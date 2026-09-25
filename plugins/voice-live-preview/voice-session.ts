import {
  CHUNK_TIMESLICE_MS,
  createDraftScheduler,
  normalizeTranscript,
} from "./draft-scheduler.js";
import {
  MIN_RECORDING_DURATION_MS,
  buildAudioInputConstraints,
  createRecordingFile,
  createRecordingWakeLock,
  downloadRecording,
  readPreferredAudioInputDeviceId,
  readVoiceUnsupportedReason,
  resolvePreferredAudioMimeType,
  voiceUnsupportedMessage,
} from "./recorder.js";
import { describeVoiceError, runFinalTranscription } from "./transcription.js";

export type VoiceSessionState = "idle" | "recording" | "transcribing";

export interface VoicePreview {
  update(text: string): void;
  commit(text: string): void;
  cancel(): void;
}

export interface VoiceToastOptions {
  description: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export interface VoiceSessionDeps {
  transcribe(args: {
    file: File;
    prompt?: string;
    signal: AbortSignal;
  }): Promise<string>;
  beginPreview(): VoicePreview;
  getPrompt(): string | undefined;
  toast: {
    error(title: string, options: VoiceToastOptions): void;
    warning(title: string, options: VoiceToastOptions): void;
  };
}

export interface VoiceSession {
  getState(): VoiceSessionState;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
  stop(): void;
  cancel(): void;
  toggle(): void;
  setDeps(deps: VoiceSessionDeps): void;
  dispose(): void;
}

export function createVoiceSession(
  initialDeps: VoiceSessionDeps,
): VoiceSession {
  let deps = initialDeps;
  const getDeps = () => deps;
  let state: VoiceSessionState = "idle";
  let generation = 0;
  let starting = false;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let mimeType = "audio/webm";
  let startedAtMs = 0;
  let shouldTranscribe = true;
  let prompt: string | undefined;
  let preview: VoicePreview | null = null;
  let finalAbort: AbortController | null = null;
  const listeners = new Set<() => void>();
  const wakeLock = createRecordingWakeLock();

  const setState = (next: VoiceSessionState) => {
    if (state === next) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const scheduler = createDraftScheduler({
    now: () => Date.now(),
    chunkCount: () => chunks.length,
    request: (count, signal) =>
      getDeps().transcribe({
        file: createRecordingFile(chunks.slice(0, count), mimeType),
        prompt,
        signal,
      }),
    onDraft: (text) => preview?.update(text),
  });

  const releaseMedia = () => {
    wakeLock.release();
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
  };

  const endPreview = () => {
    preview?.cancel();
    preview = null;
  };

  const commitPreview = (text: string) => {
    preview?.commit(text);
    preview = null;
  };

  const fail = (description: string) => {
    scheduler.stop();
    endPreview();
    setState("idle");
    getDeps().toast.error("Voice input failed", { description });
  };

  const finish = async (
    finished: MediaRecorder,
    token: number,
  ): Promise<void> => {
    scheduler.halt();
    releaseMedia();
    if (recorder === finished) recorder = null;
    const recorded = chunks;
    chunks = [];
    if (!shouldTranscribe || token !== generation) {
      shouldTranscribe = true;
      scheduler.stop();
      endPreview();
      setState("idle");
      return;
    }
    if (Date.now() - startedAtMs < MIN_RECORDING_DURATION_MS) {
      fail("Recording too short (minimum 1 second)");
      return;
    }
    if (recorded.length === 0) {
      fail("No audio was captured");
      return;
    }
    const file = createRecordingFile(recorded, finished.mimeType || mimeType);
    const controller = new AbortController();
    finalAbort = controller;
    setState("transcribing");
    await scheduler.settled();
    const outcome = controller.signal.aborted
      ? ({ kind: "cancelled" } as const)
      : await runFinalTranscription({
          transcribe: (signal) =>
            getDeps().transcribe({ file, prompt, signal }),
          signal: controller.signal,
          lastDraft: scheduler.lastDraft,
        });
    if (finalAbort === controller) finalAbort = null;
    if (outcome.kind === "cancelled" || token !== generation) return;
    if (outcome.kind === "transcript") {
      commitPreview(outcome.text);
      setState("idle");
      return;
    }
    const options: VoiceToastOptions = {
      description: describeVoiceError(outcome.error),
      duration: Infinity,
      action: {
        label: "Download recording",
        onClick: () => downloadRecording(file),
      },
    };
    if (outcome.kind === "fallback") {
      commitPreview(outcome.text);
      setState("idle");
      getDeps().toast.warning("Voice input used the live preview", options);
      return;
    }
    endPreview();
    setState("idle");
    getDeps().toast.error("Voice input failed", options);
  };

  const start = async (): Promise<void> => {
    if (state !== "idle" || starting) return;
    const unsupported = readVoiceUnsupportedReason();
    if (unsupported !== null) {
      getDeps().toast.error("Voice input failed", {
        description: voiceUnsupportedMessage(unsupported),
      });
      return;
    }
    starting = true;
    generation += 1;
    const token = generation;
    const deviceId = readPreferredAudioInputDeviceId();
    try {
      const media = await navigator.mediaDevices.getUserMedia(
        buildAudioInputConstraints(deviceId),
      );
      if (token !== generation) {
        for (const track of media.getTracks()) track.stop();
        return;
      }
      stream = media;
      chunks = [];
      startedAtMs = Date.now();
      shouldTranscribe = true;
      prompt = deps.getPrompt();
      preview = deps.beginPreview();
      wakeLock.acquire();
      const preferredMimeType = resolvePreferredAudioMimeType();
      mimeType = preferredMimeType ?? "audio/webm";
      const next = preferredMimeType
        ? new MediaRecorder(media, { mimeType: preferredMimeType })
        : new MediaRecorder(media);
      recorder = next;
      next.onstart = () => {
        if (next.mimeType) mimeType = next.mimeType;
        setState("recording");
      };
      next.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      next.onerror = () => {
        shouldTranscribe = false;
        releaseMedia();
        fail("Voice recording failed");
      };
      next.onstop = () => {
        void finish(next, token);
      };
      scheduler.start(startedAtMs);
      next.start(CHUNK_TIMESLICE_MS);
    } catch (error) {
      scheduler.stop();
      releaseMedia();
      recorder = null;
      chunks = [];
      if (token === generation) {
        fail(describeVoiceError(error, deviceId !== null));
      }
    } finally {
      starting = false;
    }
  };

  const stop = () => {
    if (state !== "recording" || recorder?.state !== "recording") return;
    shouldTranscribe = true;
    try {
      recorder.stop();
    } catch (error) {
      fail(describeVoiceError(error));
    }
  };

  const cancel = () => {
    if (starting) {
      generation += 1;
      return;
    }
    if (state === "recording" && recorder?.state === "recording") {
      shouldTranscribe = false;
      scheduler.stop();
      try {
        recorder.stop();
      } catch {
        releaseMedia();
        endPreview();
        setState("idle");
      }
      return;
    }
    if (state === "transcribing") {
      finalAbort?.abort();
      finalAbort = null;
      scheduler.stop();
      endPreview();
      setState("idle");
    }
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    stop,
    cancel,
    toggle() {
      if (state === "idle") void start();
      else if (state === "recording") stop();
    },
    setDeps(next) {
      deps = next;
    },
    dispose() {
      generation += 1;
      shouldTranscribe = false;
      scheduler.stop();
      finalAbort?.abort();
      finalAbort = null;
      const active = recorder;
      recorder = null;
      if (active?.state === "recording") {
        try {
          active.stop();
        } catch {}
      }
      releaseMedia();
      endPreview();
      chunks = [];
      state = "idle";
    },
  };
}

export function appendTranscript(current: string, text: string): string {
  const normalized = normalizeTranscript(text);
  if (normalized.length === 0) return current;
  return current.length === 0 || /\s$/u.test(current)
    ? `${current}${normalized}`
    : `${current} ${normalized}`;
}
