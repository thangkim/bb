import { SAMPLE_RATE, type SpeechSegment } from "./segmentation.js";

export const MAX_SPAN_SAMPLES = 25 * SAMPLE_RATE;

export interface LanguageSpan {
  readonly start: number;
  readonly speechEnd: number;
  readonly end: number;
  readonly language: string | null;
}

export function groupSpans(
  segments: readonly SpeechSegment[],
  languages: readonly (string | null)[],
  maxSamples: number = MAX_SPAN_SAMPLES,
): LanguageSpan[] {
  const spans: LanguageSpan[] = [];
  segments.forEach((segment, index) => {
    const language = languages[index] ?? null;
    const previous = spans.at(-1);
    if (
      previous !== undefined &&
      previous.language === language &&
      segment.end - previous.start <= maxSamples
    ) {
      spans[spans.length - 1] = {
        start: previous.start,
        speechEnd: segment.speechEnd,
        end: segment.end,
        language,
      };
      return;
    }
    spans.push({
      start: segment.start,
      speechEnd: segment.speechEnd,
      end: segment.end,
      language,
    });
  });
  return spans;
}
