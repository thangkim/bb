import { describe, expect, it } from "vitest";
import {
  discoverLanguageModel,
  discoverWhisperPaths,
  type DiscoveryEnvironment,
} from "./discovery.js";

const OPENWHISPR = "/Applications/OpenWhispr.app/Contents/Resources";
const MODEL_DIR = "/Users/me/.cache/openwhispr/whisper-models";

function environment(files: readonly string[]): DiscoveryEnvironment {
  const present = new Set(files);
  return {
    homeDir: "/Users/me",
    pathEnv: "/usr/bin:/bin",
    arch: "arm64",
    isExecutable: async (filePath) => present.has(filePath),
    isFile: async (filePath) => present.has(filePath),
  };
}

const NO_OVERRIDES = {
  serverPath: null,
  modelPath: null,
  ffmpegPath: null,
  languageModelPath: null,
};

describe("discoverWhisperPaths", () => {
  it("reuses OpenWhispr's binaries and its best multilingual model", async () => {
    const result = await discoverWhisperPaths(
      NO_OVERRIDES,
      environment([
        `${OPENWHISPR}/bin/whisper-server-darwin-arm64`,
        `${OPENWHISPR}/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg`,
        `${MODEL_DIR}/ggml-small.bin`,
        `${MODEL_DIR}/ggml-large-v3-turbo.bin`,
      ]),
    );

    expect(result).toEqual({
      ok: true,
      paths: {
        serverPath: `${OPENWHISPR}/bin/whisper-server-darwin-arm64`,
        modelPath: `${MODEL_DIR}/ggml-large-v3-turbo.bin`,
        ffmpegPath: `${OPENWHISPR}/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg`,
      },
    });
  });

  it("prefers Homebrew binaries over OpenWhispr's bundled copies", async () => {
    const result = await discoverWhisperPaths(
      NO_OVERRIDES,
      environment([
        "/opt/homebrew/bin/whisper-server",
        `${OPENWHISPR}/bin/whisper-server-darwin-arm64`,
        "/opt/homebrew/bin/ffmpeg",
        `${MODEL_DIR}/ggml-base.bin`,
      ]),
    );

    expect(result.ok && result.paths.serverPath).toBe(
      "/opt/homebrew/bin/whisper-server",
    );
    expect(result.ok && result.paths.ffmpegPath).toBe(
      "/opt/homebrew/bin/ffmpeg",
    );
  });

  it("ignores English-only models that cannot transcribe Russian or Vietnamese", async () => {
    const result = await discoverWhisperPaths(
      NO_OVERRIDES,
      environment([
        "/opt/homebrew/bin/whisper-server",
        "/opt/homebrew/bin/ffmpeg",
        `${MODEL_DIR}/ggml-base.en.bin`,
      ]),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain(
      "No multilingual Whisper model",
    );
  });

  it("reports a configured path that does not exist instead of falling back", async () => {
    const result = await discoverWhisperPaths(
      { ...NO_OVERRIDES, modelPath: "/models/missing.bin" },
      environment([
        "/opt/homebrew/bin/whisper-server",
        "/opt/homebrew/bin/ffmpeg",
        `${MODEL_DIR}/ggml-large-v3-turbo.bin`,
      ]),
    );

    expect(result).toEqual({
      ok: false,
      message: "Whisper model not found at /models/missing.bin.",
    });
  });
});

describe("discoverLanguageModel", () => {
  it("prefers OpenWhispr's base model, then small, then the plugin's download", async () => {
    const downloaded = "/data/ggml-base.bin";
    expect(
      await discoverLanguageModel(
        null,
        environment([
          `${MODEL_DIR}/ggml-small.bin`,
          `${MODEL_DIR}/ggml-base.bin`,
        ]),
        "/data",
      ),
    ).toBe(`${MODEL_DIR}/ggml-base.bin`);
    expect(
      await discoverLanguageModel(
        null,
        environment([`${MODEL_DIR}/ggml-small.bin`, downloaded]),
        "/data",
      ),
    ).toBe(`${MODEL_DIR}/ggml-small.bin`);
    expect(
      await discoverLanguageModel(null, environment([downloaded]), "/data"),
    ).toBe(downloaded);
    expect(
      await discoverLanguageModel(null, environment([]), "/data"),
    ).toBeNull();
  });

  it("does not fall back when a configured model is missing", async () => {
    expect(
      await discoverLanguageModel(
        "/models/missing.bin",
        environment([`${MODEL_DIR}/ggml-base.bin`]),
        "/data",
      ),
    ).toBeNull();
  });
});
