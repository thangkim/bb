import path from "node:path";
import type { LocalWhisperPaths, ResolvedWhisperPaths } from "./contract.js";

export const OPENWHISPR_APP_NAME = "OpenWhispr.app";
export const OPENWHISPR_MODEL_DIR = ".cache/openwhispr/whisper-models";

export const MODEL_PREFERENCE = [
  "ggml-large-v3-turbo.bin",
  "ggml-large-v3-turbo-q8_0.bin",
  "ggml-large-v3-turbo-q5_0.bin",
  "ggml-large-v3.bin",
  "ggml-medium.bin",
  "ggml-small.bin",
  "ggml-base.bin",
] as const;

const EXTRA_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"] as const;

export interface DiscoveryEnvironment {
  readonly homeDir: string;
  readonly pathEnv: string;
  readonly arch: string;
  isExecutable(filePath: string): Promise<boolean>;
  isFile(filePath: string): Promise<boolean>;
}

export type DiscoveryResult =
  | { readonly ok: true; readonly paths: ResolvedWhisperPaths }
  | { readonly ok: false; readonly message: string };

function openWhisprAppRoots(env: DiscoveryEnvironment): string[] {
  return [
    path.join("/Applications", OPENWHISPR_APP_NAME),
    path.join(env.homeDir, "Applications", OPENWHISPR_APP_NAME),
  ];
}

function binDirs(env: DiscoveryEnvironment): string[] {
  const fromEnv = env.pathEnv
    .split(path.delimiter)
    .filter((dir) => dir.length > 0);
  return [...new Set([...fromEnv, ...EXTRA_BIN_DIRS])];
}

async function firstMatch(
  candidates: readonly string[],
  test: (candidate: string) => Promise<boolean>,
): Promise<string | null> {
  for (const candidate of candidates) {
    if (await test(candidate)) return candidate;
  }
  return null;
}

async function resolveOne(
  override: string | null,
  candidates: readonly string[],
  test: (candidate: string) => Promise<boolean>,
  describe: { what: string; missing: string },
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  if (override !== null) {
    return (await test(override))
      ? { ok: true, path: override }
      : { ok: false, message: `${describe.what} not found at ${override}.` };
  }
  const found = await firstMatch(candidates, test);
  return found === null
    ? { ok: false, message: describe.missing }
    : { ok: true, path: found };
}

export function serverCandidates(env: DiscoveryEnvironment): string[] {
  const openWhisprArch = env.arch === "arm64" ? "arm64" : "x64";
  return [
    ...binDirs(env).map((dir) => path.join(dir, "whisper-server")),
    ...openWhisprAppRoots(env).map((root) =>
      path.join(
        root,
        "Contents/Resources/bin",
        `whisper-server-darwin-${openWhisprArch}`,
      ),
    ),
  ];
}

export function ffmpegCandidates(env: DiscoveryEnvironment): string[] {
  return [
    ...binDirs(env).map((dir) => path.join(dir, "ffmpeg")),
    ...openWhisprAppRoots(env).map((root) =>
      path.join(
        root,
        "Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg",
      ),
    ),
  ];
}

export function modelCandidates(env: DiscoveryEnvironment): string[] {
  const modelDir = path.join(env.homeDir, OPENWHISPR_MODEL_DIR);
  return MODEL_PREFERENCE.map((name) => path.join(modelDir, name));
}

export async function discoverWhisperPaths(
  overrides: LocalWhisperPaths,
  env: DiscoveryEnvironment,
): Promise<DiscoveryResult> {
  const server = await resolveOne(
    overrides.serverPath,
    serverCandidates(env),
    env.isExecutable,
    {
      what: "whisper-server",
      missing:
        "whisper-server not found. Install OpenWhispr or run `brew install whisper-cpp`.",
    },
  );
  if (!server.ok) return server;
  const model = await resolveOne(
    overrides.modelPath,
    modelCandidates(env),
    env.isFile,
    {
      what: "Whisper model",
      missing: `No multilingual Whisper model in ~/${OPENWHISPR_MODEL_DIR}. Download one in OpenWhispr or set the model file in the plugin settings.`,
    },
  );
  if (!model.ok) return model;
  const ffmpeg = await resolveOne(
    overrides.ffmpegPath,
    ffmpegCandidates(env),
    env.isExecutable,
    {
      what: "ffmpeg",
      missing:
        "ffmpeg not found. Install OpenWhispr or run `brew install ffmpeg`.",
    },
  );
  if (!ffmpeg.ok) return ffmpeg;
  return {
    ok: true,
    paths: {
      serverPath: server.path,
      modelPath: model.path,
      ffmpegPath: ffmpeg.path,
    },
  };
}

export const LANGUAGE_MODEL_PREFERENCE = [
  "ggml-base.bin",
  "ggml-base-q8_0.bin",
  "ggml-small.bin",
  "ggml-small-q8_0.bin",
] as const;
export const DOWNLOADED_LANGUAGE_MODEL = "ggml-base.bin";
export const LANGUAGE_MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";

export function languageModelCandidates(
  env: DiscoveryEnvironment,
  dataDir: string,
): string[] {
  const modelDir = path.join(env.homeDir, OPENWHISPR_MODEL_DIR);
  return [
    ...LANGUAGE_MODEL_PREFERENCE.map((name) => path.join(modelDir, name)),
    path.join(dataDir, DOWNLOADED_LANGUAGE_MODEL),
  ];
}

export async function discoverLanguageModel(
  override: string | null,
  env: DiscoveryEnvironment,
  dataDir: string,
): Promise<string | null> {
  if (override !== null) {
    return (await env.isFile(override)) ? override : null;
  }
  return firstMatch(languageModelCandidates(env, dataDir), env.isFile);
}
