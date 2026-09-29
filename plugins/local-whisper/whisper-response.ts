import { z } from "zod";

const inferenceResponseSchema = z.union([
  z.object({ error: z.string() }),
  z.object({
    text: z.string(),
    language: z.string().optional(),
  }),
]);

export type InferenceResponse =
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "transcript";
      readonly text: string;
      readonly detectedLanguage: string | null;
    };

const NON_SPEECH_TOKEN = /\[(?:[A-Z_]+|\s*BLANK_AUDIO\s*)\]/gu;

const WHISPER_LANGUAGE_CODES: ReadonlyMap<string, string> = new Map([
  ["english", "en"],
  ["chinese", "zh"],
  ["german", "de"],
  ["spanish", "es"],
  ["russian", "ru"],
  ["korean", "ko"],
  ["french", "fr"],
  ["japanese", "ja"],
  ["portuguese", "pt"],
  ["turkish", "tr"],
  ["polish", "pl"],
  ["catalan", "ca"],
  ["dutch", "nl"],
  ["arabic", "ar"],
  ["swedish", "sv"],
  ["italian", "it"],
  ["indonesian", "id"],
  ["hindi", "hi"],
  ["finnish", "fi"],
  ["vietnamese", "vi"],
  ["hebrew", "he"],
  ["ukrainian", "uk"],
  ["greek", "el"],
  ["malay", "ms"],
  ["czech", "cs"],
  ["romanian", "ro"],
  ["danish", "da"],
  ["hungarian", "hu"],
  ["tamil", "ta"],
  ["norwegian", "no"],
  ["thai", "th"],
  ["urdu", "ur"],
  ["croatian", "hr"],
  ["bulgarian", "bg"],
  ["lithuanian", "lt"],
  ["latin", "la"],
  ["maori", "mi"],
  ["malayalam", "ml"],
  ["welsh", "cy"],
  ["slovak", "sk"],
  ["telugu", "te"],
  ["persian", "fa"],
  ["latvian", "lv"],
  ["bengali", "bn"],
  ["serbian", "sr"],
  ["azerbaijani", "az"],
  ["slovenian", "sl"],
  ["kannada", "kn"],
  ["estonian", "et"],
  ["macedonian", "mk"],
  ["breton", "br"],
  ["basque", "eu"],
  ["icelandic", "is"],
  ["armenian", "hy"],
  ["nepali", "ne"],
  ["mongolian", "mn"],
  ["bosnian", "bs"],
  ["kazakh", "kk"],
  ["albanian", "sq"],
  ["swahili", "sw"],
  ["galician", "gl"],
  ["marathi", "mr"],
  ["punjabi", "pa"],
  ["sinhala", "si"],
  ["khmer", "km"],
  ["shona", "sn"],
  ["yoruba", "yo"],
  ["somali", "so"],
  ["afrikaans", "af"],
  ["occitan", "oc"],
  ["georgian", "ka"],
  ["belarusian", "be"],
  ["tajik", "tg"],
  ["sindhi", "sd"],
  ["gujarati", "gu"],
  ["amharic", "am"],
  ["yiddish", "yi"],
  ["lao", "lo"],
  ["uzbek", "uz"],
  ["faroese", "fo"],
  ["haitian creole", "ht"],
  ["pashto", "ps"],
  ["turkmen", "tk"],
  ["nynorsk", "nn"],
  ["maltese", "mt"],
  ["sanskrit", "sa"],
  ["luxembourgish", "lb"],
  ["myanmar", "my"],
  ["tibetan", "bo"],
  ["tagalog", "tl"],
  ["malagasy", "mg"],
  ["assamese", "as"],
  ["tatar", "tt"],
  ["hawaiian", "haw"],
  ["lingala", "ln"],
  ["hausa", "ha"],
  ["bashkir", "ba"],
  ["javanese", "jw"],
  ["sundanese", "su"],
  ["cantonese", "yue"],
]);

export function languageCode(name: string): string | null {
  const normalized = name.trim().toLowerCase();
  if (WHISPER_LANGUAGE_CODES.has(normalized)) {
    return WHISPER_LANGUAGE_CODES.get(normalized)!;
  }
  return /^[a-z]{2,3}$/u.test(normalized) ? normalized : null;
}

export function parseInferenceResponse(rawText: string): InferenceResponse {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return {
      kind: "error",
      message: `whisper-server returned a non-JSON response: ${rawText.slice(0, 200)}`,
    };
  }
  const parsed = inferenceResponseSchema.safeParse(json);
  if (!parsed.success) {
    return {
      kind: "error",
      message: "whisper-server response did not include transcript text.",
    };
  }
  if ("error" in parsed.data) {
    return { kind: "error", message: `whisper-server: ${parsed.data.error}` };
  }
  const language = parsed.data.language;
  return {
    kind: "transcript",
    text: parsed.data.text,
    detectedLanguage: language === undefined ? null : languageCode(language),
  };
}

const languageIdResponseSchema = z.object({
  language_probabilities: z.record(z.string(), z.number()),
});

export interface LanguageChoice {
  readonly language: string | null;
  readonly share: number;
}

export function parseLanguageChoice(
  rawText: string,
  languages: readonly string[],
): LanguageChoice | null {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return null;
  }
  const parsed = languageIdResponseSchema.safeParse(json);
  if (!parsed.success) return null;
  const probabilities = parsed.data.language_probabilities;
  let best: string | null = null;
  let bestProbability = 0;
  let total = 0;
  for (const code of languages) {
    const probability = probabilities[code] ?? 0;
    total += probability;
    if (probability > bestProbability) {
      best = code;
      bestProbability = probability;
    }
  }
  return { language: best, share: total > 0 ? bestProbability / total : 0 };
}

export function cleanTranscript(text: string): string {
  return text
    .replace(NON_SPEECH_TOKEN, " ")
    .replace(/\s+/gu, " ")
    .replace(/\s+([.,!?;:…])/gu, "$1")
    .trim();
}

export function joinPieces(
  pieces: ReadonlyArray<{ text: string; language: string | null }>,
): string {
  const parts: Array<{ text: string; language: string | null }> = [];
  for (const piece of pieces) {
    const text = cleanTranscript(piece.text);
    if (text.length === 0) continue;
    const previous = parts.at(-1);
    if (
      previous !== undefined &&
      previous.language === piece.language &&
      /^\p{Ll}/u.test(text) &&
      /[^.]\.$/u.test(previous.text)
    ) {
      previous.text = previous.text.slice(0, -1);
    }
    parts.push({ text, language: piece.language });
  }
  return parts.map((part) => part.text).join(" ");
}
