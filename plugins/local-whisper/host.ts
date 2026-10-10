import { Buffer } from "node:buffer";
import path from "node:path";
import {
  experimental_defineHostEntry,
  type ExperimentalHostWorkerLease,
} from "@get-bb/plugin-sdk/host";
import {
  localWhisperHostContract,
  type LocalWhisperPaths,
  type LocalWhisperStatus,
  type LocalWhisperTranscribeInput,
  type LocalWhisperTranscribeResult,
  type ResolvedWhisperPaths,
} from "./contract.js";
import {
  DOWNLOADED_LANGUAGE_MODEL,
  LANGUAGE_MODEL_URL,
  discoverLanguageModel,
  discoverWhisperPaths,
  type DiscoveryEnvironment,
} from "./discovery.js";
import { createHostRuntime } from "./host-runtime.js";
import {
  createSegmentCache,
  recordingKey,
  segmentKey,
  type SegmentTranscript,
} from "./segment-cache.js";
import {
  SAMPLE_RATE,
  findSpeechSegments,
  wavFromSamples,
  type SpeechSegment,
} from "./segmentation.js";
import {
  createServerPool,
  type ServerPoolDependencies,
  type ServerSpec,
} from "./server-pool.js";
import { groupSpans, type LanguageSpan } from "./spans.js";
import {
  joinPieces,
  parseInferenceResponse,
  parseLanguageChoice,
  type InferenceResponse,
  type LanguageChoice,
} from "./whisper-response.js";

export {
  READY_POLL_MS,
  STARTUP_TIMEOUT_MS,
  type WhisperServerChild,
} from "./server-pool.js";

export const DETECTION_BUDGET_MS = 5_000;
export const MIN_DETECTION_SPEECH_SAMPLES = 0.4 * SAMPLE_RATE;
export const RELIABLE_DETECTION_SPEECH_SAMPLES = 1 * SAMPLE_RATE;
export const LANGUAGE_MODEL_RETRY_MS = 10 * 60_000;
const MIN_RELIABLE_SHARE = 0.6;
const MIN_SHORT_CONFIDENT_SHARE = 0.9;

export interface LocalWhisperHostDependencies extends ServerPoolDependencies {
  readonly discovery: DiscoveryEnvironment;
  convertToPcm(args: {
    ffmpegPath: string;
    audio: Uint8Array;
    tempDir: string;
    signal: AbortSignal;
  }): Promise<Uint8Array<ArrayBuffer>>;
  downloadFile(
    url: string,
    destination: string,
    signal: AbortSignal,
  ): Promise<void>;
  schedule(ms: number, callback: () => void): () => void;
}

interface HandlerContext {
  readonly lifecycle: { readonly signal: AbortSignal };
  readonly experimental_paths: { readonly dataDir: string };
  experimental_retainWorker(): ExperimentalHostWorkerLease;
}

type LanguageModelState = Extract<
  LocalWhisperStatus,
  { ready: true }
>["languageModel"];

type Transcript = Extract<InferenceResponse, { kind: "transcript" }>;

interface RecordingContext {
  readonly samples: Int16Array;
  readonly recording: string | null;
  readonly port: number;
  readonly languagePort: number | null;
  readonly languages: readonly string[];
  readonly hint: string | null;
  readonly signal: AbortSignal;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Voice transcription was cancelled");
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function transcribeSpec(paths: ResolvedWhisperPaths): ServerSpec {
  return {
    serverPath: paths.serverPath,
    modelPath: paths.modelPath,
    extraArgs: ["-l", "auto", "-nlp"],
  };
}

function languageSpec(
  paths: ResolvedWhisperPaths,
  modelPath: string,
): ServerSpec {
  return {
    serverPath: paths.serverPath,
    modelPath,
    extraArgs: ["-l", "auto"],
  };
}

export function createLocalWhisperHostEntry(
  deps: LocalWhisperHostDependencies,
) {
  const pool = createServerPool(deps);
  let lifecycleSignal: AbortSignal | null = null;
  let workerLease: ExperimentalHostWorkerLease | null = null;
  let cancelIdleStop: (() => void) | null = null;
  let unloadedWhileIdle = false;
  let languageModelDownload: Promise<void> | null = null;
  let languageModelFailure: { at: number; message: string } | null = null;
  const segmentCache = createSegmentCache(deps.now);
  let lastLanguage: string | null = null;

  function releaseWorker(): void {
    cancelIdleStop?.();
    cancelIdleStop = null;
    const lease = workerLease;
    workerLease = null;
    void lease?.dispose();
  }

  function stopServers(): void {
    releaseWorker();
    pool.stopAll();
  }

  function enter(context: HandlerContext): AbortSignal {
    if (lifecycleSignal !== context.lifecycle.signal) {
      lifecycleSignal = context.lifecycle.signal;
      lifecycleSignal.addEventListener("abort", stopServers, { once: true });
    }
    return lifecycleSignal;
  }

  function unloadWhileIdle(): void {
    unloadedWhileIdle = true;
    stopServers();
  }

  function keepLoaded(context: HandlerContext, keepLoadedMs: number): void {
    workerLease ??= context.experimental_retainWorker();
    cancelIdleStop?.();
    cancelIdleStop = deps.schedule(keepLoadedMs, unloadWhileIdle);
  }

  async function resolveLanguageModel(
    paths: LocalWhisperPaths,
    downloadMode: "start" | "report" | "never",
    dataDir: string,
    lifecycle: AbortSignal,
  ): Promise<LanguageModelState> {
    const found = await discoverLanguageModel(
      paths.languageModelPath,
      deps.discovery,
      dataDir,
    );
    if (found !== null) return { state: "ready", path: found };
    if (paths.languageModelPath !== null) {
      return {
        state: "missing",
        message: `Language model not found at ${paths.languageModelPath}.`,
      };
    }
    if (languageModelDownload !== null) return { state: "downloading" };
    if (downloadMode === "never") {
      return {
        state: "missing",
        message:
          "No base or small Whisper model found and automatic download is off; language detection uses the main model.",
      };
    }
    if (
      languageModelFailure !== null &&
      deps.now() - languageModelFailure.at < LANGUAGE_MODEL_RETRY_MS
    ) {
      return {
        state: "missing",
        message: `Downloading the language model failed: ${languageModelFailure.message}`,
      };
    }
    if (downloadMode === "report") {
      return {
        state: "missing",
        message: "Not downloaded yet; it downloads on the next dictation.",
      };
    }
    const download = deps
      .downloadFile(
        LANGUAGE_MODEL_URL,
        path.join(dataDir, DOWNLOADED_LANGUAGE_MODEL),
        lifecycle,
      )
      .then(
        () => {
          languageModelFailure = null;
        },
        (error: unknown) => {
          languageModelFailure = {
            at: deps.now(),
            message: errorMessage(error),
          };
        },
      )
      .finally(() => {
        if (languageModelDownload === download) languageModelDownload = null;
      });
    languageModelDownload = download;
    return { state: "downloading" };
  }

  async function infer(args: {
    port: number;
    wav: Uint8Array<ArrayBuffer>;
    language: string;
    reportLanguage: boolean;
    hint: string | null;
    signal: AbortSignal;
  }): Promise<Transcript> {
    const form = new FormData();
    form.set(
      "file",
      new Blob([args.wav], { type: "audio/wav" }),
      "voice-input.wav",
    );
    form.set("response_format", args.reportLanguage ? "verbose_json" : "json");
    form.set("language", args.language);
    form.set("temperature", "0");
    form.set("prompt", args.hint ?? "");
    const response = await deps.fetch(
      `http://127.0.0.1:${args.port}/inference`,
      { method: "POST", body: form, signal: args.signal },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `whisper-server returned HTTP ${response.status}: ${text.slice(0, 200)}`,
      );
    }
    const parsed = parseInferenceResponse(text);
    if (parsed.kind === "error") throw new Error(parsed.message);
    return parsed;
  }

  async function identifyLanguage(
    port: number,
    wav: Uint8Array<ArrayBuffer>,
    languages: readonly string[],
    signal: AbortSignal,
  ): Promise<LanguageChoice | null> {
    const form = new FormData();
    form.set("file", new Blob([wav], { type: "audio/wav" }), "voice-input.wav");
    form.set("response_format", "verbose_json");
    form.set("language", "auto");
    form.set("detect_language", "true");
    form.set("temperature", "0");
    form.set("prompt", "");
    const response = await deps.fetch(`http://127.0.0.1:${port}/inference`, {
      method: "POST",
      body: form,
      signal,
    });
    if (!response.ok) return null;
    return parseLanguageChoice(await response.text(), languages);
  }

  async function segmentLanguage(
    segment: SpeechSegment,
    previous: string | null,
    context: RecordingContext,
  ): Promise<string | null> {
    const { languages } = context;
    if (languages.length === 0) return null;
    if (languages.length === 1) return languages[0]!;
    const fallback = previous ?? languages[0]!;
    const key =
      context.recording === null
        ? null
        : `${context.recording}\0${segment.start}`;
    const remembered = key === null ? null : segmentCache.language(key);
    const speech = segment.speechEnd - segment.speechStart;
    const reliableLength = speech >= RELIABLE_DETECTION_SPEECH_SAMPLES;
    if (remembered !== null && (remembered.reliable || !reliableLength)) {
      return remembered.language;
    }
    if (speech < MIN_DETECTION_SPEECH_SAMPLES) {
      return remembered?.language ?? fallback;
    }
    const wav = wavFromSamples(
      context.samples.subarray(segment.start, segment.end),
    );
    if (context.languagePort !== null) {
      const choice = await identifyLanguage(
        context.languagePort,
        wav,
        languages,
        context.signal,
      ).catch(() => null);
      if (choice?.language != null) {
        if (reliableLength && choice.share >= MIN_RELIABLE_SHARE) {
          if (key !== null) {
            segmentCache.rememberLanguage(key, {
              language: choice.language,
              reliable: true,
            });
          }
          return choice.language;
        }
        if (!reliableLength && choice.share >= MIN_SHORT_CONFIDENT_SHARE) {
          if (key !== null) {
            segmentCache.rememberLanguage(key, {
              language: choice.language,
              reliable: false,
            });
          }
          return choice.language;
        }
      }
    }
    const detected = await infer({
      port: context.port,
      wav,
      language: "auto",
      reportLanguage: true,
      hint: null,
      signal: context.signal,
    });
    const language =
      detected.detectedLanguage !== null &&
      languages.includes(detected.detectedLanguage)
        ? detected.detectedLanguage
        : fallback;
    if (key !== null) {
      segmentCache.rememberLanguage(key, {
        language,
        reliable: reliableLength,
      });
    }
    return language;
  }

  async function transcribeSpan(
    span: LanguageSpan,
    context: RecordingContext,
  ): Promise<SegmentTranscript> {
    const language = span.language ?? "auto";
    const key = segmentKey(
      context.samples.subarray(span.start, span.speechEnd),
      {
        languages: [language],
        hint: context.hint,
      },
    );
    const cached = segmentCache.transcript(key);
    if (cached !== null) return cached;
    const result = await infer({
      port: context.port,
      wav: wavFromSamples(context.samples.subarray(span.start, span.end)),
      language,
      reportLanguage: false,
      hint: context.hint,
      signal: context.signal,
    });
    const transcript = { text: result.text, language: span.language };
    segmentCache.rememberTranscript(key, transcript);
    return transcript;
  }

  async function transcribe(
    input: LocalWhisperTranscribeInput,
    signal: AbortSignal,
    paths: { tempDir: string; dataDir: string },
    lifecycle: AbortSignal,
  ): Promise<LocalWhisperTranscribeResult> {
    const startedAt = deps.now();
    const found = await discoverWhisperPaths(input.paths, deps.discovery);
    if (!found.ok) return { ok: false, message: found.message };
    try {
      const languageModel =
        input.languages.length < 2
          ? null
          : await resolveLanguageModel(
              input.paths,
              input.downloadLanguageModel ? "start" : "never",
              paths.dataDir,
              lifecycle,
            );
      const languagePortPromise =
        languageModel?.state === "ready"
          ? pool
              .ensure("language", languageSpec(found.paths, languageModel.path))
              .catch(() => null)
          : Promise.resolve(null);
      const [port, pcm, languagePort] = await Promise.all([
        raceAbort(
          pool.ensure("transcribe", transcribeSpec(found.paths)),
          signal,
        ),
        deps.convertToPcm({
          ffmpegPath: found.paths.ffmpegPath,
          audio: Buffer.from(input.audioBase64, "base64"),
          tempDir: paths.tempDir,
          signal,
        }),
        raceAbort(languagePortPromise, signal),
      ]);
      const samples = new Int16Array(
        pcm.buffer,
        pcm.byteOffset,
        Math.floor(pcm.byteLength / 2),
      );
      const context: RecordingContext = {
        samples,
        recording: recordingKey(samples, input.languages),
        port,
        languagePort,
        languages: input.languages,
        hint: input.hint,
        signal,
      };
      const segments = findSpeechSegments(samples);
      const segmentLanguages: (string | null)[] = [];
      let previous =
        lastLanguage !== null && input.languages.includes(lastLanguage)
          ? lastLanguage
          : null;
      for (const segment of segments) {
        const language =
          deps.now() - startedAt > DETECTION_BUDGET_MS
            ? (previous ?? input.languages[0] ?? null)
            : await segmentLanguage(segment, previous, context);
        segmentLanguages.push(language);
        previous = language ?? previous;
      }
      const pieces: SegmentTranscript[] = [];
      for (const span of groupSpans(segments, segmentLanguages)) {
        pieces.push(await transcribeSpan(span, context));
      }
      if (previous !== null) lastLanguage = previous;
      return {
        ok: true,
        text: joinPieces(pieces),
        languages: [
          ...new Set(
            pieces.flatMap((piece) =>
              piece.language === null ? [] : [piece.language],
            ),
          ),
        ],
        elapsedMs: deps.now() - startedAt,
      };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  async function status(
    input: {
      paths: LocalWhisperPaths;
      preload: boolean;
      downloadLanguageModel: boolean;
    },
    dataDir: string,
    lifecycle: AbortSignal,
  ): Promise<LocalWhisperStatus> {
    const found = await discoverWhisperPaths(input.paths, deps.discovery);
    if (!found.ok) return { ready: false, message: found.message };
    const languageModel = await resolveLanguageModel(
      input.paths,
      !input.downloadLanguageModel
        ? "never"
        : input.preload
          ? "start"
          : "report",
      dataDir,
      lifecycle,
    );
    if (input.preload) {
      void pool
        .ensure("transcribe", transcribeSpec(found.paths))
        .catch(() => undefined);
      if (languageModel.state === "ready") {
        void pool
          .ensure("language", languageSpec(found.paths, languageModel.path))
          .catch(() => undefined);
      }
    }
    return {
      ready: true,
      paths: found.paths,
      running: pool.isReady("transcribe", transcribeSpec(found.paths)),
      languageModel,
    };
  }

  return experimental_defineHostEntry({
    contract: localWhisperHostContract,
    handlers: {
      async status(input, context) {
        const lifecycle = enter(context);
        const preload = input.preload && !unloadedWhileIdle;
        const result = await status(
          { ...input, preload },
          context.experimental_paths.dataDir,
          lifecycle,
        );
        if (result.ready && preload && cancelIdleStop === null) {
          keepLoaded(context, input.keepLoadedMs);
        }
        return result;
      },
      async transcribe(input, context) {
        const lifecycle = enter(context);
        unloadedWhileIdle = false;
        keepLoaded(context, input.keepLoadedMs);
        return transcribe(
          input,
          context.signal,
          context.experimental_paths,
          lifecycle,
        );
      },
    },
    dispose() {
      stopServers();
    },
  });
}

export default createLocalWhisperHostEntry(createHostRuntime());
