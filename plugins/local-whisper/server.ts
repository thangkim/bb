import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginAiServiceStatus,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  MAX_KEEP_LOADED_MINUTES,
  MAX_LANGUAGES,
  languageCodeSchema,
  localWhisperHostContract,
  type LocalWhisperPaths,
  type LocalWhisperTranscribeResult,
} from "./contract.js";

export const SERVICE_ID = "local-whisper";
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const TRANSCRIBE_CALL_TIMEOUT_MS = 130_000;
const STATUS_CALL_TIMEOUT_MS = 5_000;
const CLI_TEXT_LIMIT = 20_000;

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

const optionalAbsolutePath = z
  .string()
  .refine(
    (value) => value === "" || path.isAbsolute(value),
    "Use an absolute path, or leave it empty to find it automatically",
  );

const languagesSetting = z
  .string()
  .refine(
    (value) => parseLanguagesOrNull(value) !== null,
    `Use up to ${MAX_LANGUAGES} comma-separated Whisper language codes, such as en,ru,vi`,
  );

export function parseLanguagesOrNull(value: string): string[] | null {
  const codes = value
    .split(",")
    .map((code) => code.trim().toLowerCase())
    .filter((code) => code.length > 0);
  const unique = [...new Set(codes)];
  if (unique.length > MAX_LANGUAGES) return null;
  return unique.every((code) => languageCodeSchema.safeParse(code).success)
    ? unique
    : null;
}

function nullIfEmpty(value: string): string | null {
  return value.length > 0 ? value : null;
}

export default function localWhisperPlugin(bb: BbPluginApi): void {
  const host = bb.hosts.experimental_client({
    contract: localWhisperHostContract,
  });
  const settings = bb.settings.define({
    languages: {
      type: "string",
      label: "Languages",
      description:
        "Comma-separated Whisper language codes you speak. Detection picks among them; one code always uses that language; empty allows any language.",
      default: "en,ru,vi",
      experimental_schema: languagesSetting,
    },
    preload: {
      type: "boolean",
      label: "Preload the model",
      description:
        "Start loading the model when bb checks voice input availability, so the first dictation does not wait for it.",
      default: true,
    },
    keepLoadedMinutes: {
      type: "number",
      label: "Keep the model loaded (minutes)",
      description:
        "How long whisper-server stays in memory after the last use. The turbo model uses about 2 GB.",
      default: 60,
      experimental_schema: z.number().int().min(1).max(MAX_KEEP_LOADED_MINUTES),
    },
    modelPath: {
      type: "string",
      label: "Model file",
      description:
        "Absolute path to a ggml Whisper model. Empty uses the best model OpenWhispr downloaded to ~/.cache/openwhispr/whisper-models.",
      default: "",
      experimental_schema: optionalAbsolutePath,
    },
    serverPath: {
      type: "string",
      label: "whisper-server binary",
      description:
        "Absolute path to whisper.cpp's whisper-server. Empty searches PATH, Homebrew, then OpenWhispr.app.",
      default: "",
      experimental_schema: optionalAbsolutePath,
    },
    ffmpegPath: {
      type: "string",
      label: "ffmpeg binary",
      description:
        "Absolute path to ffmpeg. Empty searches PATH, Homebrew, then OpenWhispr.app.",
      default: "",
      experimental_schema: optionalAbsolutePath,
    },
    languageModelPath: {
      type: "string",
      label: "Language detection model",
      description:
        "Absolute path to a small multilingual ggml model used only to tell languages apart. Empty uses OpenWhispr's base or small model, or the one this plugin downloaded.",
      default: "",
      experimental_schema: optionalAbsolutePath,
    },
    downloadLanguageModel: {
      type: "boolean",
      label: "Download the language detection model",
      description:
        "When no base or small model is found, download ggml-base.bin (about 148 MB) from Hugging Face once. Without it, language detection uses the main model and live drafts are slower.",
      default: true,
    },
  });

  async function readConfig(): Promise<{
    paths: LocalWhisperPaths;
    languages: string[];
    preload: boolean;
    keepLoadedMs: number;
    downloadLanguageModel: boolean;
  }> {
    const values = await settings.get();
    return {
      preload: values.preload,
      downloadLanguageModel: values.downloadLanguageModel,
      keepLoadedMs: values.keepLoadedMinutes * 60_000,
      paths: {
        serverPath: nullIfEmpty(values.serverPath),
        modelPath: nullIfEmpty(values.modelPath),
        ffmpegPath: nullIfEmpty(values.ffmpegPath),
        languageModelPath: nullIfEmpty(values.languageModelPath),
      },
      languages: parseLanguagesOrNull(values.languages) ?? [],
    };
  }

  async function primaryHostId(): Promise<string | null> {
    return (await bb.sdk.system.config()).primaryHostId;
  }

  async function transcribeBytes(args: {
    audio: Uint8Array;
    hint: string | null;
    languages: string[] | null;
    signal: AbortSignal | undefined;
  }): Promise<Extract<LocalWhisperTranscribeResult, { ok: true }>> {
    if (args.audio.byteLength > MAX_AUDIO_BYTES) {
      throw new Error("Recordings over 25 MB are too large to transcribe");
    }
    const hostId = await primaryHostId();
    if (hostId === null) throw new Error("No primary machine is connected");
    const config = await readConfig();
    const result = await host.call(
      "transcribe",
      {
        paths: config.paths,
        keepLoadedMs: config.keepLoadedMs,
        downloadLanguageModel: config.downloadLanguageModel,
        languages: args.languages ?? config.languages,
        audioBase64: Buffer.from(args.audio).toString("base64"),
        hint: args.hint,
      },
      { hostId, signal: args.signal, timeoutMs: TRANSCRIBE_CALL_TIMEOUT_MS },
    );
    if (!result.ok) throw new Error(result.message);
    return result;
  }

  async function readStatus(allowPreload: boolean) {
    const hostId = await primaryHostId();
    if (hostId === null) {
      return {
        ready: false as const,
        message: "No primary machine is connected",
      };
    }
    const config = await readConfig();
    return host.call(
      "status",
      {
        paths: config.paths,
        preload: allowPreload && config.preload,
        keepLoadedMs: config.keepLoadedMs,
        downloadLanguageModel: config.downloadLanguageModel,
      },
      { hostId, timeoutMs: STATUS_CALL_TIMEOUT_MS },
    );
  }

  bb.experimental_aiServices.register({
    id: SERVICE_ID,
    displayName: "Local Whisper",
    runsLocally: true,
    async transcribe(audio, { signal, hint }) {
      const result = await transcribeBytes({
        audio: new Uint8Array(await audio.arrayBuffer()),
        hint,
        languages: null,
        signal,
      });
      return result.text;
    },
    async status(): Promise<PluginAiServiceStatus> {
      const status = await readStatus(true);
      return status.ready ? { ready: true } : status;
    },
  });

  bb.cli.register(
    defineCli({
      name: "local-whisper",
      summary: "Transcribe voice input locally with whisper.cpp",
      description:
        "Local Whisper runs whisper.cpp's whisper-server on the primary machine, reusing OpenWhispr's binaries and models when they are installed. Select it with `bb settings ai-services set voice <service-id>`.",
      commands: {
        status: cliCommand({
          summary:
            "Show the whisper-server, model, and ffmpeg in use and whether the model is loaded",
          options: { json: JSON_OPTION },
          async run(input) {
            const [status, config] = await Promise.all([
              readStatus(false),
              readConfig(),
            ]);
            if (input.options.json) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  ...status,
                  languages: config.languages,
                }),
              };
            }
            const languages =
              config.languages.length > 0 ? config.languages.join(", ") : "any";
            const stdout = status.ready
              ? [
                  "Ready",
                  `Model: ${status.paths.modelPath}`,
                  `whisper-server: ${status.paths.serverPath}`,
                  `ffmpeg: ${status.paths.ffmpegPath}`,
                  `Loaded: ${status.running ? "yes" : "no, loads on the next transcription"}`,
                  `Language detection: ${
                    status.languageModel.state === "ready"
                      ? status.languageModel.path
                      : status.languageModel.state === "downloading"
                        ? "downloading the base model"
                        : status.languageModel.message
                  }`,
                  `Languages: ${languages}`,
                ].join("\n")
              : `Not ready: ${status.message}`;
            return { exitCode: status.ready ? 0 : 1, stdout };
          },
        }),
        transcribe: cliCommand({
          summary: "Transcribe an audio file with the local model",
          positionals: [
            {
              name: "file",
              description:
                "Audio file to transcribe (webm, wav, mp3, m4a, ogg), relative to the current directory",
              required: true,
            },
          ],
          options: {
            language: {
              type: "string",
              description:
                "Whisper language code to force, such as vi; defaults to the plugin's Languages setting",
            },
            json: JSON_OPTION,
          },
          async run(input, ctx) {
            const filePath = path.resolve(
              ctx.cwd ?? process.cwd(),
              input.positionals.file,
            );
            let audio: Uint8Array;
            try {
              audio = await readFile(filePath);
            } catch (error) {
              throw new PluginCliError(`Cannot read ${filePath}`, {
                code: "file_unreadable",
                hint: error instanceof Error ? error.message : undefined,
              });
            }
            let languages: string[] | null = null;
            if (input.options.language !== undefined) {
              const parsed = parseLanguagesOrNull(input.options.language);
              if (parsed === null || parsed.length !== 1) {
                throw new PluginCliError(
                  `Invalid language code "${input.options.language}"`,
                  {
                    code: "invalid_language",
                    hint: "Use one Whisper language code, such as en, ru, or vi",
                  },
                );
              }
              languages = parsed;
            }
            const result = await transcribeBytes({
              audio,
              hint: null,
              languages,
              signal: ctx.signal,
            });
            const text =
              result.text.length > CLI_TEXT_LIMIT
                ? `${result.text.slice(0, CLI_TEXT_LIMIT)}...`
                : result.text;
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({
                    text,
                    languages: result.languages,
                    elapsedMs: result.elapsedMs,
                  })
                : `${text}\n\nLanguages: ${result.languages.length > 0 ? result.languages.join(", ") : "unknown"} · ${(result.elapsedMs / 1000).toFixed(1)}s`,
            };
          },
        }),
      },
    }),
  );
}
