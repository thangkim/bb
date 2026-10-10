import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { describe, expect, it, vi, type Mock } from "vitest";
import {
  createLocalWhisperHostEntry,
  type LocalWhisperHostDependencies,
} from "./host.js";
import { SAMPLE_RATE } from "./segmentation.js";

const SERVER = "/opt/homebrew/bin/whisper-server";
const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const TURBO =
  "/Users/me/.cache/openwhispr/whisper-models/ggml-large-v3-turbo.bin";
const BASE = "/Users/me/.cache/openwhispr/whisper-models/ggml-base.bin";
const SMALL = "/models/ggml-small.bin";
const DATA_DIR = "/test/plugin-data";
const KEEP_LOADED_MS = 30 * 60_000;
const AUTO_PATHS = {
  serverPath: null,
  modelPath: null,
  ffmpegPath: null,
  languageModelPath: null,
};

const AMPLITUDE = { en: 4000, vi: 6000, ru: 8000, zh: 10000 } as const;
const SPOKEN_LANGUAGE_BY_AMPLITUDE = new Map<number, string>(
  Object.entries(AMPLITUDE).map(([language, amplitude]) => [
    amplitude,
    language,
  ]),
);
const LANGUAGE_NAMES: Record<string, string> = {
  en: "english",
  vi: "vietnamese",
  ru: "russian",
  zh: "chinese",
};

type Part =
  | { speech: keyof typeof AMPLITUDE; ms: number }
  | { pauseMs: number };

function recording(parts: readonly Part[]): Uint8Array {
  const chunks = parts.map((part) => {
    if ("pauseMs" in part) {
      return new Int16Array(Math.round((part.pauseMs * SAMPLE_RATE) / 1000));
    }
    const samples = new Int16Array(Math.round((part.ms * SAMPLE_RATE) / 1000));
    const amplitude = AMPLITUDE[part.speech];
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = index % 2 === 0 ? amplitude : -amplitude;
    }
    return samples;
  });
  const joined = new Int16Array(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return new Uint8Array(joined.buffer);
}

function transcribeInput(
  overrides: Partial<{
    modelPath: string;
    audio: Uint8Array;
    languages: string[];
    downloadLanguageModel: boolean;
  }> = {},
) {
  return {
    paths: { ...AUTO_PATHS, modelPath: overrides.modelPath ?? null },
    keepLoadedMs: KEEP_LOADED_MS,
    downloadLanguageModel: overrides.downloadLanguageModel ?? false,
    languages: overrides.languages ?? ["en", "ru", "vi"],
    audioBase64: Buffer.from(
      overrides.audio ?? recording([{ speech: "en", ms: 1500 }]),
    ).toString("base64"),
    hint: null,
  };
}

function statusInput(preload: boolean, downloadLanguageModel = false) {
  return {
    paths: AUTO_PATHS,
    preload,
    keepLoadedMs: KEEP_LOADED_MS,
    downloadLanguageModel,
  };
}

interface FakeChild {
  readonly args: readonly string[];
  readonly kill: Mock<() => void>;
  exit(): void;
  listening: boolean;
  stderr: string;
}

interface InferenceRequest {
  spoken: string;
  language: string;
  format: string;
}

async function spokenLanguage(form: FormData): Promise<string> {
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new Error("missing audio");
  const samples = new Int16Array((await file.arrayBuffer()).slice(44));
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return SPOKEN_LANGUAGE_BY_AMPLITUDE.get(peak) ?? "unknown";
}

function createFakeRuntime(
  options: {
    startsListening?: boolean;
    yieldWhilePolling?: boolean;
    inferenceMs?: number;
    languageModel?: boolean;
    unsureAboutShortAudio?: boolean;
  } = {},
) {
  const children: FakeChild[] = [];
  const requests: InferenceRequest[] = [];
  const languageRequests: string[] = [];
  const downloads: Array<{ url: string; destination: string }> = [];
  const files = new Set([TURBO, SMALL]);
  if (options.languageModel === true) files.add(BASE);
  let clock = 0;
  let nextPort = 40_000;
  const timers: Array<{ callback: () => void; cancelled: boolean }> = [];

  const deps: LocalWhisperHostDependencies = {
    discovery: {
      homeDir: "/Users/me",
      pathEnv: "/opt/homebrew/bin",
      arch: "arm64",
      isExecutable: async (filePath) =>
        filePath === SERVER || filePath === FFMPEG,
      isFile: async (filePath) => files.has(filePath),
    },
    spawnServer(_serverPath, args) {
      const exitListeners: Array<() => void> = [];
      let exited = false;
      const child: FakeChild = {
        args,
        listening: options.startsListening ?? true,
        stderr: "",
        kill: vi.fn<() => void>(() => child.exit()),
        exit() {
          if (exited) return;
          exited = true;
          child.listening = false;
          for (const listener of exitListeners) listener();
        },
      };
      children.push(child);
      return {
        kill: () => child.kill(),
        onExit: (listener) => {
          if (exited) listener();
          else exitListeners.push(listener);
        },
        stderrTail: () => child.stderr,
      };
    },
    freePort: async () => nextPort++,
    async fetch(url, init) {
      const child = children.find(
        (candidate) =>
          candidate.listening && url.includes(`:${candidate.args[5]}/`),
      );
      if (init.method !== "POST") {
        if (child === undefined) throw new Error("connection refused");
        return new Response("ok", { status: 200 });
      }
      if (child === undefined) throw new Error("connection refused");
      const form = init.body as FormData;
      const spoken = await spokenLanguage(form);
      if (child.args[1] === BASE) {
        const file = form.get("file") as Blob;
        const seconds = (file.size - 44) / 2 / SAMPLE_RATE;
        languageRequests.push(spoken);
        return new Response(
          JSON.stringify({
            text: "",
            language_probabilities:
              seconds < 1.2 && options.unsureAboutShortAudio === true
                ? { [spoken]: 0.5, en: 0.45 }
                : { [spoken]: 0.97, en: 0.01 },
          }),
          { status: 200 },
        );
      }
      const language = String(form.get("language"));
      const format = String(form.get("response_format"));
      requests.push({ spoken, language, format });
      clock += options.inferenceMs ?? 0;
      const text =
        language === spoken || language === "auto"
          ? `[${spoken}]`
          : `[${spoken} translated to ${language}]`;
      const body =
        format === "verbose_json"
          ? { text, language: LANGUAGE_NAMES[spoken] ?? spoken }
          : { text };
      return new Response(JSON.stringify(body), { status: 200 });
    },
    convertToPcm: async ({ audio }) => new Uint8Array(audio),
    async downloadFile(url, destination) {
      downloads.push({ url, destination });
      files.add(destination);
    },
    now: () => clock,
    delay: async (ms) => {
      if (options.yieldWhilePolling === true) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      clock += ms;
    },
    schedule(_ms, callback) {
      const timer = { callback, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
  const fireIdleTimer = () => {
    const pending = timers.filter((timer) => !timer.cancelled);
    expect(pending).toHaveLength(1);
    pending[0]!.cancelled = true;
    pending[0]!.callback();
  };
  return {
    deps,
    children,
    requests,
    languageRequests,
    downloads,
    fireIdleTimer,
    scheduledTimers: () => timers.length,
  };
}

function harnessFor(runtime: ReturnType<typeof createFakeRuntime>) {
  return experimental_createHostEntryHarness(
    createLocalWhisperHostEntry(runtime.deps),
  );
}

const MIXED: Part[] = [
  { speech: "en", ms: 1500 },
  { pauseMs: 800 },
  { speech: "vi", ms: 1500 },
  { pauseMs: 800 },
  { speech: "ru", ms: 1500 },
];

describe("Local Whisper transcription", () => {
  it("transcribes each sentence of a mixed-language recording in its own language", async () => {
    const runtime = createFakeRuntime({ languageModel: true });
    const harness = harnessFor(runtime);

    await expect(
      harness.experimental_call(
        "transcribe",
        transcribeInput({ audio: recording(MIXED) }),
      ),
    ).resolves.toMatchObject({
      ok: true,
      text: "[en] [vi] [ru]",
      languages: ["en", "vi", "ru"],
    });
    expect(runtime.languageRequests).toEqual(["en", "vi", "ru"]);
    expect(runtime.requests).toEqual([
      { spoken: "en", language: "en", format: "json" },
      { spoken: "vi", language: "vi", format: "json" },
      { spoken: "ru", language: "ru", format: "json" },
    ]);
    await harness.experimental_dispose();
  });

  it("transcribes consecutive sentences in the same language in one pass", async () => {
    const runtime = createFakeRuntime({ languageModel: true });
    const harness = harnessFor(runtime);

    await harness.experimental_call(
      "transcribe",
      transcribeInput({
        audio: recording([
          { speech: "en", ms: 1500 },
          { pauseMs: 800 },
          { speech: "en", ms: 1500 },
        ]),
      }),
    );

    expect(runtime.requests).toEqual([
      { spoken: "en", language: "en", format: "json" },
    ]);
    await harness.experimental_dispose();
  });

  it("does not split on short pauses between words", async () => {
    const runtime = createFakeRuntime({ languageModel: true });
    const harness = harnessFor(runtime);

    await harness.experimental_call(
      "transcribe",
      transcribeInput({
        audio: recording([
          { speech: "en", ms: 1200 },
          { pauseMs: 250 },
          { speech: "en", ms: 1200 },
        ]),
      }),
    );

    expect(runtime.languageRequests).toHaveLength(1);
    expect(runtime.requests).toHaveLength(1);
    await harness.experimental_dispose();
  });

  it("reuses finished sentences in another language from earlier drafts", async () => {
    const runtime = createFakeRuntime({ languageModel: true });
    const harness = harnessFor(runtime);
    const firstSentence: Part[] = [
      { speech: "en", ms: 1500 },
      { pauseMs: 800 },
    ];

    await harness.experimental_call(
      "transcribe",
      transcribeInput({ audio: recording(firstSentence) }),
    );
    const afterFirstDraft = runtime.requests.length;
    await expect(
      harness.experimental_call(
        "transcribe",
        transcribeInput({
          audio: recording([...firstSentence, { speech: "vi", ms: 1500 }]),
        }),
      ),
    ).resolves.toMatchObject({ text: "[en] [vi]" });

    expect(runtime.requests.slice(afterFirstDraft)).toEqual([
      { spoken: "vi", language: "vi", format: "json" },
    ]);
    expect(runtime.languageRequests).toEqual(["en", "vi"]);
    await harness.experimental_dispose();
  });

  it("trusts a confident language model on a new sentence's first words", async () => {
    const runtime = createFakeRuntime({ languageModel: true });
    const harness = harnessFor(runtime);
    const firstSentence: Part[] = [
      { speech: "ru", ms: 1500 },
      { pauseMs: 800 },
    ];
    await harness.experimental_call(
      "transcribe",
      transcribeInput({ audio: recording(firstSentence) }),
    );
    const afterFirstDraft = runtime.requests.length;

    await expect(
      harness.experimental_call(
        "transcribe",
        transcribeInput({
          audio: recording([...firstSentence, { speech: "vi", ms: 500 }]),
        }),
      ),
    ).resolves.toMatchObject({ text: "[ru] [vi]" });

    expect(runtime.requests.slice(afterFirstDraft)).toEqual([
      { spoken: "vi", language: "vi", format: "json" },
    ]);
    await harness.experimental_dispose();
  });

  it("asks the main model when the language model is unsure about a new sentence's first words", async () => {
    const runtime = createFakeRuntime({
      languageModel: true,
      unsureAboutShortAudio: true,
    });
    const harness = harnessFor(runtime);
    const firstSentence: Part[] = [
      { speech: "ru", ms: 1500 },
      { pauseMs: 800 },
    ];
    await harness.experimental_call(
      "transcribe",
      transcribeInput({ audio: recording(firstSentence) }),
    );
    const afterFirstDraft = runtime.requests.length;

    await expect(
      harness.experimental_call(
        "transcribe",
        transcribeInput({
          audio: recording([...firstSentence, { speech: "vi", ms: 500 }]),
        }),
      ),
    ).resolves.toMatchObject({ text: "[ru] [vi]" });

    expect(runtime.requests.slice(afterFirstDraft)).toEqual([
      { spoken: "vi", language: "auto", format: "verbose_json" },
      { spoken: "vi", language: "vi", format: "json" },
    ]);
    await harness.experimental_dispose();
  });

  it("remembers a sentence's language once it has a second of speech", async () => {
    const runtime = createFakeRuntime({ languageModel: true });
    const harness = harnessFor(runtime);

    for (const ms of [500, 700, 1500, 2500]) {
      await harness.experimental_call(
        "transcribe",
        transcribeInput({ audio: recording([{ speech: "vi", ms }]) }),
      );
    }

    expect(
      runtime.requests.filter((request) => request.format === "verbose_json"),
    ).toHaveLength(0);
    expect(runtime.languageRequests).toEqual(["vi", "vi"]);
    await harness.experimental_dispose();
  });

  it("detects with the main model when no language model is available", async () => {
    const runtime = createFakeRuntime();
    const harness = harnessFor(runtime);

    await expect(
      harness.experimental_call(
        "transcribe",
        transcribeInput({ audio: recording(MIXED) }),
      ),
    ).resolves.toMatchObject({ text: "[en] [vi] [ru]" });

    expect(runtime.languageRequests).toEqual([]);
    expect(
      runtime.requests.filter((request) => request.format === "verbose_json"),
    ).toHaveLength(3);
    expect(runtime.children).toHaveLength(1);
    await harness.experimental_dispose();
  });

  it("downloads the language model once when none is installed", async () => {
    const runtime = createFakeRuntime();
    const harness = harnessFor(runtime);

    await harness.experimental_call(
      "transcribe",
      transcribeInput({ downloadLanguageModel: true }),
    );
    await harness.experimental_call(
      "transcribe",
      transcribeInput({ downloadLanguageModel: true }),
    );

    expect(runtime.downloads).toEqual([
      {
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        destination: `${DATA_DIR}/ggml-base.bin`,
      },
    ]);
    expect(runtime.children.map((child) => child.args[1])).toEqual([
      TURBO,
      `${DATA_DIR}/ggml-base.bin`,
    ]);
    await harness.experimental_dispose();
  });

  it("uses a listed language when Whisper detects an unlisted one", async () => {
    const runtime = createFakeRuntime({ languageModel: true });
    const harness = harnessFor(runtime);

    await expect(
      harness.experimental_call(
        "transcribe",
        transcribeInput({ audio: recording([{ speech: "zh", ms: 1500 }]) }),
      ),
    ).resolves.toMatchObject({ languages: ["en"] });
    await harness.experimental_dispose();
  });

  it("forces a single configured language without detecting", async () => {
    const runtime = createFakeRuntime({ languageModel: true });
    const harness = harnessFor(runtime);

    await harness.experimental_call(
      "transcribe",
      transcribeInput({ languages: ["vi"] }),
    );

    expect(runtime.requests).toEqual([
      { spoken: "en", language: "vi", format: "json" },
    ]);
    expect(runtime.languageRequests).toEqual([]);
    expect(runtime.children).toHaveLength(1);
    await harness.experimental_dispose();
  });

  it("returns empty text for a silent recording without calling whisper", async () => {
    const runtime = createFakeRuntime({ languageModel: true });
    const harness = harnessFor(runtime);

    await expect(
      harness.experimental_call(
        "transcribe",
        transcribeInput({ audio: recording([{ pauseMs: 3000 }]) }),
      ),
    ).resolves.toMatchObject({ ok: true, text: "", languages: [] });
    expect(runtime.requests).toHaveLength(0);
    await harness.experimental_dispose();
  });

  it("stops detecting once the time budget is spent and keeps the last language", async () => {
    const runtime = createFakeRuntime({ inferenceMs: 3_000 });
    const harness = harnessFor(runtime);
    const parts: Part[] = [];
    for (const speech of ["en", "vi", "ru", "en"] as const) {
      parts.push({ speech, ms: 1500 }, { pauseMs: 800 });
    }

    await expect(
      harness.experimental_call(
        "transcribe",
        transcribeInput({ audio: recording(parts) }),
      ),
    ).resolves.toMatchObject({ languages: ["en", "vi"] });

    expect(
      runtime.requests.filter((request) => request.format === "verbose_json"),
    ).toHaveLength(2);
    await harness.experimental_dispose();
  });
});

describe("Local Whisper server lifecycle", () => {
  it("keeps one whisper-server loaded across transcriptions", async () => {
    const runtime = createFakeRuntime();
    const harness = harnessFor(runtime);

    await harness.experimental_call("transcribe", transcribeInput());
    await harness.experimental_call("transcribe", transcribeInput());

    expect(runtime.children).toHaveLength(1);
    expect(runtime.children[0]!.args).toEqual([
      "-m",
      TURBO,
      "--host",
      "127.0.0.1",
      "--port",
      "40000",
      "-l",
      "auto",
      "-nlp",
    ]);
    await expect(
      harness.experimental_call("status", statusInput(false)),
    ).resolves.toMatchObject({ ready: true, running: true });
    await harness.experimental_dispose();
  });

  it("keeps the model loaded until it has been idle for the configured time", async () => {
    const runtime = createFakeRuntime();
    const harness = harnessFor(runtime);

    await harness.experimental_call("transcribe", transcribeInput());
    await harness.experimental_call("transcribe", transcribeInput());
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(1);
    expect(runtime.children[0]!.kill).not.toHaveBeenCalled();

    runtime.fireIdleTimer();

    expect(runtime.children[0]!.kill).toHaveBeenCalledOnce();
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
    await harness.experimental_dispose();
  });

  it("preloads the model from a status check only when asked", async () => {
    const runtime = createFakeRuntime();
    const harness = harnessFor(runtime);

    await harness.experimental_call("status", statusInput(false));
    expect(runtime.children).toHaveLength(0);

    await harness.experimental_call("status", statusInput(true));
    await vi.waitFor(() => expect(runtime.children).toHaveLength(1));
    await vi.waitFor(async () =>
      expect(
        await harness.experimental_call("status", statusInput(false)),
      ).toMatchObject({ running: true }),
    );
    await harness.experimental_dispose();
  });

  it("counts idle time from the last dictation, not from status checks", async () => {
    const runtime = createFakeRuntime();
    const harness = harnessFor(runtime);

    await harness.experimental_call("transcribe", transcribeInput());
    expect(runtime.scheduledTimers()).toBe(1);
    await harness.experimental_call("status", statusInput(true));
    await harness.experimental_call("status", statusInput(true));
    expect(runtime.scheduledTimers()).toBe(1);

    runtime.fireIdleTimer();
    expect(runtime.children[0]!.kill).toHaveBeenCalledOnce();
    await harness.experimental_dispose();
  });

  it("waits for the next dictation to reload a model unloaded while idle", async () => {
    const runtime = createFakeRuntime();
    const harness = harnessFor(runtime);

    await harness.experimental_call("status", statusInput(true));
    await vi.waitFor(() => expect(runtime.children).toHaveLength(1));
    runtime.fireIdleTimer();
    expect(runtime.children[0]!.kill).toHaveBeenCalledOnce();
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);

    await harness.experimental_call("status", statusInput(true));
    expect(runtime.children).toHaveLength(1);
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);

    await harness.experimental_call("transcribe", transcribeInput());
    expect(runtime.children).toHaveLength(2);
    runtime.fireIdleTimer();
    await harness.experimental_call("status", statusInput(true));
    expect(runtime.children).toHaveLength(2);
    await harness.experimental_dispose();
  });

  it("restarts whisper-server when the configured model changes", async () => {
    const runtime = createFakeRuntime();
    const harness = harnessFor(runtime);

    await harness.experimental_call("transcribe", transcribeInput());
    await harness.experimental_call(
      "transcribe",
      transcribeInput({ modelPath: SMALL }),
    );

    expect(runtime.children).toHaveLength(2);
    expect(runtime.children[0]!.kill).toHaveBeenCalledOnce();
    expect(runtime.children[1]!.args[1]).toBe(SMALL);
    await harness.experimental_dispose();
  });

  it("reports why whisper-server died while loading and starts fresh next time", async () => {
    const runtime = createFakeRuntime({
      startsListening: false,
      yieldWhilePolling: true,
    });
    const harness = harnessFor(runtime);
    const pending = harness.experimental_call("transcribe", transcribeInput());
    await vi.waitFor(() => expect(runtime.children).toHaveLength(1));
    runtime.children[0]!.stderr = "failed to load model";
    runtime.children[0]!.exit();

    await expect(pending).resolves.toEqual({
      ok: false,
      message:
        "whisper-server exited while loading the model: failed to load model",
    });

    const retry = harness.experimental_call("transcribe", transcribeInput());
    await vi.waitFor(() => expect(runtime.children).toHaveLength(2));
    runtime.children[1]!.listening = true;
    await expect(retry).resolves.toMatchObject({ ok: true });
    await harness.experimental_dispose();
  });

  it("gives up and kills a whisper-server that never finishes loading", async () => {
    const runtime = createFakeRuntime({ startsListening: false });
    const harness = harnessFor(runtime);

    await expect(
      harness.experimental_call("transcribe", transcribeInput()),
    ).resolves.toEqual({
      ok: false,
      message: "whisper-server did not finish loading the model in time",
    });
    expect(runtime.children[0]!.kill).toHaveBeenCalledOnce();
    await harness.experimental_dispose();
  });

  it("stops whisper-server when the worker shuts down", async () => {
    const runtime = createFakeRuntime();
    const harness = harnessFor(runtime);
    await harness.experimental_call("transcribe", transcribeInput());

    await harness.experimental_dispose();

    expect(runtime.children[0]!.kill).toHaveBeenCalled();
  });

  it("reports missing pieces without starting anything", async () => {
    const runtime = createFakeRuntime();
    const harness = harnessFor(runtime);

    await expect(
      harness.experimental_call("status", {
        ...statusInput(true),
        paths: { ...AUTO_PATHS, serverPath: "/missing/whisper-server" },
      }),
    ).resolves.toEqual({
      ready: false,
      message: "whisper-server not found at /missing/whisper-server.",
    });
    expect(runtime.children).toHaveLength(0);
    await harness.experimental_dispose();
  });
});
