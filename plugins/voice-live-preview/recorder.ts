export const MIN_RECORDING_DURATION_MS = 1_000;
export const AUDIO_INPUT_DEVICE_STORAGE_KEY =
  "bb.voiceInput.audioInputDeviceId";

const MAX_AUDIO_INPUT_DEVICE_ID_LENGTH = 1024;

export type VoiceUnsupportedReason = "insecure-origin" | "unsupported-browser";

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

export function readPreferredAudioInputDeviceId(): string | null {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(AUDIO_INPUT_DEVICE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (
    stored === null ||
    stored.trim().length === 0 ||
    stored.length > MAX_AUDIO_INPUT_DEVICE_ID_LENGTH
  ) {
    return null;
  }
  return stored;
}

export function buildAudioInputConstraints(
  deviceId: string | null,
): MediaStreamConstraints {
  return deviceId === null
    ? { audio: true }
    : { audio: { deviceId: { exact: deviceId } } };
}

export function resolvePreferredAudioMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const candidate of ["audio/webm", "audio/mp4", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return null;
}

export function createRecordingFile(chunks: Blob[], mimeType: string): File {
  const extension = mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("mp4")
      ? "mp4"
      : "webm";
  return new File(
    [new Blob(chunks, { type: mimeType })],
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

export interface RecordingWakeLock {
  acquire(): void;
  release(): void;
}

export function createRecordingWakeLock(): RecordingWakeLock {
  let wanted = false;
  let sentinel: WakeLockSentinel | null = null;
  let pending: Promise<void> | null = null;

  const request = () => {
    if (
      !wanted ||
      typeof navigator === "undefined" ||
      !("wakeLock" in navigator) ||
      window.isSecureContext === false ||
      document.visibilityState !== "visible" ||
      (sentinel !== null && !sentinel.released) ||
      pending !== null
    ) {
      return;
    }
    pending = navigator.wakeLock
      .request("screen")
      .then((next) => {
        if (!wanted) {
          if (!next.released) void next.release().catch(() => {});
          return;
        }
        sentinel = next;
        next.addEventListener("release", () => {
          if (sentinel === next) sentinel = null;
        });
      })
      .catch(() => {})
      .finally(() => {
        pending = null;
      });
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") request();
  };

  return {
    acquire() {
      if (wanted) return;
      wanted = true;
      document.addEventListener("visibilitychange", onVisibilityChange);
      request();
    },
    release() {
      if (!wanted) return;
      wanted = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const held = sentinel;
      sentinel = null;
      if (held !== null && !held.released) void held.release().catch(() => {});
    },
  };
}
