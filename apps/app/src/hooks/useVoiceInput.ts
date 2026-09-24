import { useCallback, useEffect, useRef, useState } from "react";
import { appToast } from "@/components/ui/app-toast";
import {
  buildAudioInputConstraints,
  useAudioInputDevicePreferenceValue,
} from "@/lib/audio-input-device-preference";
import {
  isDocumentVisible,
  subscribeToDocumentVisibility,
} from "@/lib/document-visibility";
import {
  readVoiceSupportEnvironment,
  resolveVoiceSupport,
  voiceUnsupportedMessage,
  type VoiceUnsupportedReason,
} from "./voice-input-support";

type VoiceInputState = "idle" | "recording" | "transcribing" | "error";

interface TranscribeArgs {
  file: File;
  promptContext?: string;
  signal?: AbortSignal;
}

interface UseVoiceInputOptions {
  onTranscript: (transcript: string) => void;
  onTranscribe: (args: TranscribeArgs) => Promise<string>;
  onDraftTranscribe?: (args: TranscribeArgs) => Promise<string>;
  getPromptContext?: () => string | undefined;
}

const MIN_RECORDING_DURATION_MS = 1_000;
const CHUNK_TIMESLICE_MS = 250;

const DRAFT_INTERVAL_MIN_MS = 3_000;
const DRAFT_INTERVAL_MAX_MS = 8_000;
const DRAFT_INTERVAL_GROWTH = 1.4;
const DRAFT_MIN_AUDIO_MS = 3_000;
const DRAFT_MIN_NEW_AUDIO_MS = 2_500;
const DRAFT_MAX_REQUESTS = 12;
const DRAFT_MAX_RECORDING_MS = 180_000;

const HTML_DOCUMENT_PATTERN = /<!doctype html|<html[\s>]/i;

function normalizeTranscript(rawText: string): string {
  return rawText.replace(/\s+/g, " ").trim();
}

function sanitizeErrorMessage(raw: string): string | null {
  let normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return null;
  }

  const htmlDocumentMatch = normalized.search(HTML_DOCUMENT_PATTERN);
  if (htmlDocumentMatch >= 0) {
    normalized = normalized.slice(0, htmlDocumentMatch).trim();
  }
  if (normalized.length === 0) {
    return null;
  }

  normalized = normalized.replace(/^HTTP\s+\d{3}:\s*/i, "").trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized;
}

function resolveRecordingErrorMessage(
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
  if (error instanceof Error && error.message.trim().length > 0) {
    const message = sanitizeErrorMessage(error.message);
    if (message) {
      return message;
    }
  }
  return "Voice input failed";
}

function resolvePreferredAudioMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = ["audio/webm", "audio/mp4", "audio/ogg"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return null;
}

function createRecordingFile(audioBlob: Blob, mimeType: string): File {
  const extension = mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("mp4")
      ? "mp4"
      : "webm";
  return new File([audioBlob], `recording.${extension}`, {
    type: mimeType,
  });
}

function downloadRecording(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function useVoiceInput(options: UseVoiceInputOptions) {
  const preferredAudioInputDeviceId = useAudioInputDevicePreferenceValue();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtMsRef = useRef<number | null>(null);
  const promptContextRef = useRef<string | undefined>(undefined);
  const shouldTranscribeRef = useRef(true);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const draftTimeoutRef = useRef<number | null>(null);
  const draftAbortRef = useRef<AbortController | null>(null);
  const draftIntervalMsRef = useRef(DRAFT_INTERVAL_MIN_MS);
  const draftRequestCountRef = useRef(0);
  const draftStoppedRef = useRef(true);
  const draftInFlightRef = useRef<Promise<void> | null>(null);
  const draftChunkCountRef = useRef(0);
  const draftTranscriptRef = useRef("");
  const wakeLockSentinelRef = useRef<WakeLockSentinel | null>(null);
  const wakeLockRequestRef = useRef<Promise<void> | null>(null);
  const shouldHoldWakeLockRef = useRef(false);

  const [state, setState] = useState<VoiceInputState>("idle");
  const [isSupported, setIsSupported] = useState(false);
  const [unsupportedReason, setUnsupportedReason] =
    useState<VoiceUnsupportedReason | null>("unsupported-browser");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [draftTranscript, setDraftTranscriptState] = useState("");

  const setDraftTranscript = useCallback((text: string) => {
    draftTranscriptRef.current = text;
    setDraftTranscriptState(text);
  }, []);

  const haltDraftLoop = useCallback(() => {
    draftStoppedRef.current = true;
    if (draftTimeoutRef.current !== null) {
      window.clearTimeout(draftTimeoutRef.current);
      draftTimeoutRef.current = null;
    }
  }, []);

  const stopDraftLoop = useCallback(() => {
    haltDraftLoop();
    draftAbortRef.current?.abort();
    draftAbortRef.current = null;
  }, [haltDraftLoop]);

  const showError = useCallback((message: string) => {
    setState("error");
    setDraftTranscript("");
    appToast.error("Voice input failed", { description: message });
  }, [setDraftTranscript]);

  const stopMediaStream = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const requestRecordingWakeLock = useCallback(() => {
    if (
      typeof window === "undefined" ||
      typeof navigator === "undefined" ||
      typeof document === "undefined" ||
      !("wakeLock" in navigator) ||
      window.isSecureContext === false ||
      document.visibilityState !== "visible"
    ) {
      return;
    }

    const wakeLock = navigator.wakeLock;
    if (!wakeLock) {
      return;
    }

    const currentSentinel = wakeLockSentinelRef.current;
    if (currentSentinel && !currentSentinel.released) {
      return;
    }
    if (wakeLockRequestRef.current) {
      return;
    }

    wakeLockRequestRef.current = wakeLock
      .request("screen")
      .then((sentinel) => {
        if (!shouldHoldWakeLockRef.current) {
          if (!sentinel.released) {
            void sentinel.release().catch(() => {});
          }
          return;
        }

        wakeLockSentinelRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          if (wakeLockSentinelRef.current === sentinel) {
            wakeLockSentinelRef.current = null;
          }
        });
      })
      .catch(() => {})
      .finally(() => {
        wakeLockRequestRef.current = null;
      });
  }, []);

  const releaseRecordingWakeLock = useCallback(() => {
    shouldHoldWakeLockRef.current = false;

    const sentinel = wakeLockSentinelRef.current;
    wakeLockSentinelRef.current = null;
    if (!sentinel || sentinel.released) {
      return;
    }

    void sentinel.release().catch(() => {});
  }, []);

  useEffect(() => {
    const support = resolveVoiceSupport(readVoiceSupportEnvironment());
    setIsSupported(support.isSupported);
    setUnsupportedReason(support.reason);
  }, []);

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state === "recording") {
        try {
          recorder.stop();
        } catch {}
      }
      mediaRecorderRef.current = null;
      chunksRef.current = [];
      startedAtMsRef.current = null;
      promptContextRef.current = undefined;
      shouldTranscribeRef.current = true;
      stopDraftLoop();
      releaseRecordingWakeLock();
      if (transcriptionAbortRef.current) {
        transcriptionAbortRef.current.abort();
        transcriptionAbortRef.current = null;
      }
      stopMediaStream();
    };
  }, [releaseRecordingWakeLock, stopDraftLoop, stopMediaStream]);

  useEffect(() => {
    return subscribeToDocumentVisibility(() => {
      if (isDocumentVisible() && shouldHoldWakeLockRef.current) {
        requestRecordingWakeLock();
      }
    });
  }, [requestRecordingWakeLock]);

  const start = useCallback(async () => {
    if (!isSupported) {
      showError(voiceUnsupportedMessage(unsupportedReason));
      return;
    }
    if (state === "recording" || state === "transcribing") {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        buildAudioInputConstraints(preferredAudioInputDeviceId),
      );
      streamRef.current = stream;
      setStream(stream);
      chunksRef.current = [];
      startedAtMsRef.current = Date.now();
      promptContextRef.current = options.getPromptContext?.();
      shouldTranscribeRef.current = true;
      shouldHoldWakeLockRef.current = true;
      draftRequestCountRef.current = 0;
      draftIntervalMsRef.current = DRAFT_INTERVAL_MIN_MS;
      draftStoppedRef.current = false;
      draftChunkCountRef.current = 0;
      setDraftTranscript("");
      requestRecordingWakeLock();

      const preferredMimeType = resolvePreferredAudioMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.onstart = () => {
        setState("recording");
      };

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        showError("Voice recording failed");
      };

      recorder.onstop = async () => {
        haltDraftLoop();
        releaseRecordingWakeLock();
        stopMediaStream();

        if (!shouldTranscribeRef.current) {
          stopDraftLoop();
          shouldTranscribeRef.current = true;
          chunksRef.current = [];
          promptContextRef.current = undefined;
          setDraftTranscript("");
          setState("idle");
          return;
        }

        const startedAtMs = startedAtMsRef.current ?? Date.now();
        startedAtMsRef.current = null;
        const durationMs = Date.now() - startedAtMs;

        if (durationMs < MIN_RECORDING_DURATION_MS) {
          stopDraftLoop();
          showError("Recording too short (minimum 1 second)");
          chunksRef.current = [];
          promptContextRef.current = undefined;
          return;
        }

        const chunks = chunksRef.current;
        chunksRef.current = [];
        if (chunks.length === 0) {
          stopDraftLoop();
          showError("No audio was captured");
          promptContextRef.current = undefined;
          return;
        }

        const recordedMimeType =
          recorder.mimeType || preferredMimeType || "audio/webm";
        const audioBlob = new Blob(chunks, { type: recordedMimeType });
        const audioFile = createRecordingFile(audioBlob, recordedMimeType);
        const promptContext = promptContextRef.current;
        promptContextRef.current = undefined;

        setState("transcribing");
        const abortController = new AbortController();
        transcriptionAbortRef.current = abortController;
        await draftInFlightRef.current;
        if (abortController.signal.aborted) return;
        try {
          const transcript = await options.onTranscribe({
            file: audioFile,
            promptContext,
            signal: abortController.signal,
          });
          const normalized = normalizeTranscript(transcript);
          if (normalized.length === 0) {
            throw new Error("Voice transcription returned an empty result.");
          }
          options.onTranscript(normalized);
          setDraftTranscript("");
          setState("idle");
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            setDraftTranscript("");
            setState("idle");
            return;
          }
          const fallbackTranscript = draftTranscriptRef.current;
          setDraftTranscript("");
          const toastOptions = {
            description: resolveRecordingErrorMessage(error),
            duration: Infinity,
            action: {
              label: "Download recording",
              onClick: () => downloadRecording(audioFile),
            },
          };
          if (fallbackTranscript.length > 0) {
            options.onTranscript(fallbackTranscript);
            setState("idle");
            appToast.warning(
              "Voice input used the live preview",
              toastOptions,
            );
            return;
          }
          setState("error");
          appToast.error("Voice input failed", toastOptions);
        } finally {
          if (transcriptionAbortRef.current === abortController) {
            transcriptionAbortRef.current = null;
          }
        }
      };

      const draftTranscribe = options.onDraftTranscribe;
      if (draftTranscribe) {
        const scheduleDraft = (delayMs: number): void => {
          if (draftStoppedRef.current) return;
          draftTimeoutRef.current = window.setTimeout(() => {
            draftTimeoutRef.current = null;
            void requestDraft();
          }, delayMs);
        };

        const requestDraft = async (): Promise<void> => {
          if (draftStoppedRef.current) return;
          const recordingStartedAtMs = startedAtMsRef.current;
          if (recordingStartedAtMs === null) return;

          const elapsedMs = Date.now() - recordingStartedAtMs;
          if (
            elapsedMs > DRAFT_MAX_RECORDING_MS ||
            draftRequestCountRef.current >= DRAFT_MAX_REQUESTS
          ) {
            stopDraftLoop();
            return;
          }

          const chunks = [...chunksRef.current];
          const newAudioMs =
            (chunks.length - draftChunkCountRef.current) * CHUNK_TIMESLICE_MS;
          if (
            elapsedMs < DRAFT_MIN_AUDIO_MS ||
            newAudioMs < DRAFT_MIN_NEW_AUDIO_MS
          ) {
            scheduleDraft(draftIntervalMsRef.current);
            return;
          }
          draftChunkCountRef.current = chunks.length;

          const draftMimeType =
            recorder.mimeType || preferredMimeType || "audio/webm";
          const draftFile = createRecordingFile(
            new Blob(chunks, { type: draftMimeType }),
            draftMimeType,
          );
          const abortController = new AbortController();
          draftAbortRef.current = abortController;
          draftRequestCountRef.current += 1;

          const draftRequest = draftTranscribe({
            file: draftFile,
            promptContext: promptContextRef.current,
            signal: abortController.signal,
          }).then(
            (text) => {
              if (abortController.signal.aborted) return true;
              const normalized = normalizeTranscript(text);
              if (normalized.length > 0) {
                setDraftTranscript(normalized);
              }
              return true;
            },
            () => false,
          );
          const settled = draftRequest.then(() => undefined);
          draftInFlightRef.current = settled;
          const succeeded = await draftRequest;
          if (draftInFlightRef.current === settled) {
            draftInFlightRef.current = null;
          }
          if (draftAbortRef.current === abortController) {
            draftAbortRef.current = null;
          }
          if (!succeeded) {
            stopDraftLoop();
            return;
          }

          draftIntervalMsRef.current = Math.min(
            DRAFT_INTERVAL_MAX_MS,
            Math.round(draftIntervalMsRef.current * DRAFT_INTERVAL_GROWTH),
          );
          scheduleDraft(draftIntervalMsRef.current);
        };

        scheduleDraft(DRAFT_INTERVAL_MIN_MS);
      }

      recorder.start(CHUNK_TIMESLICE_MS);
    } catch (error) {
      stopMediaStream();
      mediaRecorderRef.current = null;
      chunksRef.current = [];
      startedAtMsRef.current = null;
      promptContextRef.current = undefined;
      shouldTranscribeRef.current = true;
      transcriptionAbortRef.current = null;
      stopDraftLoop();
      releaseRecordingWakeLock();
      showError(
        resolveRecordingErrorMessage(
          error,
          preferredAudioInputDeviceId !== null,
        ),
      );
    }
  }, [
    isSupported,
    options,
    unsupportedReason,
    preferredAudioInputDeviceId,
    releaseRecordingWakeLock,
    requestRecordingWakeLock,
    haltDraftLoop,
    setDraftTranscript,
    showError,
    state,
    stopDraftLoop,
    stopMediaStream,
  ]);

  const stop = useCallback(() => {
    if (state !== "recording") {
      return;
    }

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      return;
    }
    shouldTranscribeRef.current = true;
    try {
      recorder.stop();
    } catch (error) {
      showError(resolveRecordingErrorMessage(error));
    }
  }, [showError, state]);

  const cancel = useCallback(() => {
    if (state === "recording") {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state === "recording") {
        shouldTranscribeRef.current = false;
        try {
          recorder.stop();
        } catch (error) {
          showError(resolveRecordingErrorMessage(error));
        }
      }
      return;
    }

    if (state === "transcribing") {
      const abortController = transcriptionAbortRef.current;
      if (abortController) {
        abortController.abort();
        transcriptionAbortRef.current = null;
      }
      stopDraftLoop();
      setDraftTranscript("");
      setState("idle");
    }
  }, [setDraftTranscript, showError, state, stopDraftLoop]);

  return {
    state,
    isSupported,
    unsupportedReason,
    stream,
    draftTranscript,
    isRecording: state === "recording",
    isProcessing: state === "transcribing",
    isListening: state === "recording" || state === "transcribing",
    start,
    stop,
    cancel,
  };
}
