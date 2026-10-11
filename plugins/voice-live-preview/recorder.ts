import { describeVoiceError } from "./transcription.js";

export const CHUNK_TIMESLICE_MS = 250;
export const MICROPHONE_STORAGE_KEY = "bb.voiceInput.audioInputDeviceId";

const MAX_MICROPHONE_ID_LENGTH = 1024;
const RETRYABLE_MICROPHONE_ERRORS = new Set([
  "OverconstrainedError",
  "NotFoundError",
  "DevicesNotFoundError",
  "NotReadableError",
  "TrackStartError",
]);

export type VoiceUnsupportedReason = "insecure-origin" | "unsupported-browser";

export interface MicrophoneRecording {
  readonly startedAtMs: number;
  snapshot(): File;
  stop(): Promise<File>;
  cancel(): void;
}

export function readVoiceUnsupportedReason(): VoiceUnsupportedReason | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "unsupported-browser";
  }
  if (
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof window.MediaRecorder !== "undefined"
  ) {
    return null;
  }
  return window.isSecureContext === false
    ? "insecure-origin"
    : "unsupported-browser";
}

export function voiceUnsupportedMessage(
  reason: VoiceUnsupportedReason,
): string {
  return reason === "insecure-origin"
    ? "Voice input needs an HTTPS connection to this server"
    : "Voice input is not supported in this browser";
}

export function readPreferredMicrophoneId(storage: Storage): string | null {
  let stored: string | null;
  try {
    stored = storage.getItem(MICROPHONE_STORAGE_KEY);
  } catch {
    return null;
  }
  return stored !== null &&
    stored.trim().length > 0 &&
    stored.length <= MAX_MICROPHONE_ID_LENGTH
    ? stored
    : null;
}

function microphoneConstraints(
  deviceId: string | null,
): MediaStreamConstraints {
  return deviceId === null
    ? { audio: true }
    : { audio: { deviceId: { exact: deviceId } } };
}

export async function requestMicrophoneStream(
  mediaDevices: Pick<MediaDevices, "getUserMedia">,
  preferredId: string | null,
): Promise<MediaStream> {
  if (preferredId !== null) {
    try {
      return await mediaDevices.getUserMedia(
        microphoneConstraints(preferredId),
      );
    } catch (error) {
      if (
        !(error instanceof DOMException) ||
        !RETRYABLE_MICROPHONE_ERRORS.has(error.name)
      ) {
        throw error;
      }
    }
  }
  return mediaDevices.getUserMedia(microphoneConstraints(null));
}

function resolvePreferredAudioMimeType(): string | null {
  for (const candidate of ["audio/webm", "audio/mp4", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return null;
}

export function createRecordingFile(
  chunks: readonly Blob[],
  mimeType: string,
): File {
  const extension = mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("mp4")
      ? "mp4"
      : "webm";
  return new File(
    [new Blob([...chunks], { type: mimeType })],
    `recording.${extension}`,
    {
      type: mimeType,
    },
  );
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

function createRecordingWakeLock(): { release(): void } {
  let wanted = true;
  let sentinel: WakeLockSentinel | null = null;
  let pending = false;

  const request = () => {
    if (
      !wanted ||
      pending ||
      !("wakeLock" in navigator) ||
      document.visibilityState !== "visible" ||
      (sentinel !== null && !sentinel.released)
    ) {
      return;
    }
    pending = true;
    navigator.wakeLock
      .request("screen")
      .then((next) => {
        if (wanted) sentinel = next;
        else void next.release().catch(() => {});
      })
      .catch(() => {})
      .finally(() => {
        pending = false;
      });
  };

  document.addEventListener("visibilitychange", request);
  request();
  return {
    release() {
      if (!wanted) return;
      wanted = false;
      document.removeEventListener("visibilitychange", request);
      if (sentinel !== null && !sentinel.released) {
        void sentinel.release().catch(() => {});
      }
      sentinel = null;
    },
  };
}

export async function startMicrophoneRecording(
  onFailure: (error: unknown) => void,
): Promise<MicrophoneRecording> {
  const unsupported = readVoiceUnsupportedReason();
  if (unsupported !== null) {
    throw new Error(voiceUnsupportedMessage(unsupported));
  }
  const preferredId = readPreferredMicrophoneId(window.localStorage);
  let stream: MediaStream;
  try {
    stream = await requestMicrophoneStream(navigator.mediaDevices, preferredId);
  } catch (error) {
    throw new Error(describeVoiceError(error, preferredId !== null));
  }

  const chunks: Blob[] = [];
  const preferredMimeType = resolvePreferredAudioMimeType();
  const wakeLock = createRecordingWakeLock();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    wakeLock.release();
    for (const track of stream.getTracks()) track.stop();
  };

  let recorder: MediaRecorder;
  try {
    recorder =
      preferredMimeType === null
        ? new MediaRecorder(stream)
        : new MediaRecorder(stream, { mimeType: preferredMimeType });
  } catch (error) {
    release();
    throw error;
  }
  const mimeType = () => recorder.mimeType || preferredMimeType || "audio/webm";
  const snapshot = () => createRecordingFile(chunks, mimeType());

  let pendingStop: {
    resolve: (file: File) => void;
    reject: (error: unknown) => void;
  } | null = null;
  let started = false;
  let rejectStart: ((error: unknown) => void) | null = null;

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = () => {
    release();
    pendingStop?.resolve(snapshot());
    pendingStop = null;
  };
  recorder.onerror = () => {
    release();
    const error = new Error("Voice recording failed");
    if (!started) {
      rejectStart?.(error);
    } else if (pendingStop !== null) {
      pendingStop.reject(error);
      pendingStop = null;
    } else {
      onFailure(error);
    }
  };

  await new Promise<void>((resolve, reject) => {
    rejectStart = reject;
    recorder.onstart = () => {
      started = true;
      resolve();
    };
    try {
      recorder.start(CHUNK_TIMESLICE_MS);
    } catch (error) {
      release();
      reject(error);
    }
  });

  return {
    startedAtMs: Date.now(),
    snapshot,
    stop() {
      if (recorder.state === "inactive") return Promise.resolve(snapshot());
      return new Promise<File>((resolve, reject) => {
        pendingStop = { resolve, reject };
        recorder.stop();
      });
    },
    cancel() {
      pendingStop = null;
      recorder.ondataavailable = null;
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
  };
}
