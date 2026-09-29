import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const MAX_LANGUAGES = 8;

export const languageCodeSchema = z
  .string()
  .regex(/^[a-z]{2,3}$/u, "Use two- or three-letter Whisper language codes");

export const MAX_KEEP_LOADED_MINUTES = 24 * 60;

const keepLoadedMsSchema = z
  .number()
  .int()
  .min(60_000)
  .max(MAX_KEEP_LOADED_MINUTES * 60_000);

export const localWhisperPathsSchema = z
  .object({
    serverPath: z.string().min(1).nullable(),
    modelPath: z.string().min(1).nullable(),
    ffmpegPath: z.string().min(1).nullable(),
    languageModelPath: z.string().min(1).nullable(),
  })
  .strict();
export type LocalWhisperPaths = z.infer<typeof localWhisperPathsSchema>;

const resolvedPathsSchema = z
  .object({
    serverPath: z.string().min(1),
    modelPath: z.string().min(1),
    ffmpegPath: z.string().min(1),
  })
  .strict();
export type ResolvedWhisperPaths = z.infer<typeof resolvedPathsSchema>;

export const localWhisperStatusSchema = z.discriminatedUnion("ready", [
  z
    .object({
      ready: z.literal(true),
      paths: resolvedPathsSchema,
      running: z.boolean(),
      languageModel: z.discriminatedUnion("state", [
        z
          .object({ state: z.literal("ready"), path: z.string().min(1) })
          .strict(),
        z.object({ state: z.literal("downloading") }).strict(),
        z
          .object({ state: z.literal("missing"), message: z.string().min(1) })
          .strict(),
      ]),
    })
    .strict(),
  z.object({ ready: z.literal(false), message: z.string().min(1) }).strict(),
]);
export type LocalWhisperStatus = z.infer<typeof localWhisperStatusSchema>;

export const localWhisperTranscribeInputSchema = z
  .object({
    paths: localWhisperPathsSchema,
    keepLoadedMs: keepLoadedMsSchema,
    downloadLanguageModel: z.boolean(),
    languages: z.array(languageCodeSchema).max(MAX_LANGUAGES),
    audioBase64: z.string().min(1),
    hint: z.string().nullable(),
  })
  .strict();
export type LocalWhisperTranscribeInput = z.infer<
  typeof localWhisperTranscribeInputSchema
>;

export const localWhisperTranscribeResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      text: z.string(),
      languages: z.array(z.string()),
      elapsedMs: z.number().nonnegative(),
    })
    .strict(),
  z.object({ ok: z.literal(false), message: z.string().min(1) }).strict(),
]);
export type LocalWhisperTranscribeResult = z.infer<
  typeof localWhisperTranscribeResultSchema
>;

export const localWhisperHostContract = defineRpcContract({
  status: {
    input: z
      .object({
        paths: localWhisperPathsSchema,
        preload: z.boolean(),
        keepLoadedMs: keepLoadedMsSchema,
        downloadLanguageModel: z.boolean(),
      })
      .strict(),
    output: localWhisperStatusSchema,
  },
  transcribe: {
    input: localWhisperTranscribeInputSchema,
    output: localWhisperTranscribeResultSchema,
  },
});
