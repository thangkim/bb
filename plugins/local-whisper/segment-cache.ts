import { createHash } from "node:crypto";
import { SAMPLE_RATE } from "./segmentation.js";

export const RECORDING_ID_SAMPLES = 0.25 * SAMPLE_RATE;
export const SEGMENT_CACHE_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 256;

export interface SegmentTranscript {
  readonly text: string;
  readonly language: string | null;
}

export interface RememberedLanguage {
  readonly language: string;
  readonly reliable: boolean;
}

export interface SegmentCache {
  transcript(key: string): SegmentTranscript | null;
  rememberTranscript(key: string, transcript: SegmentTranscript): void;
  language(key: string): RememberedLanguage | null;
  rememberLanguage(key: string, remembered: RememberedLanguage): void;
}

function hashSamples(samples: Int16Array): string {
  return createHash("sha256")
    .update(
      new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
    )
    .digest("hex");
}

export function segmentKey(
  samples: Int16Array,
  context: { languages: readonly string[]; hint: string | null },
): string {
  return `${context.languages.join(",")}\0${context.hint ?? ""}\0${hashSamples(samples)}`;
}

export function recordingKey(
  samples: Int16Array,
  languages: readonly string[],
): string | null {
  if (samples.length < RECORDING_ID_SAMPLES) return null;
  return `${languages.join(",")}\0${hashSamples(samples.subarray(0, RECORDING_ID_SAMPLES))}`;
}

function createLru<Value>(now: () => number) {
  const entries = new Map<string, { value: Value; expiresAt: number }>();
  return {
    get(key: string): Value | null {
      const entry = entries.get(key);
      if (entry === undefined) return null;
      entries.delete(key);
      if (entry.expiresAt <= now()) return null;
      entries.set(key, {
        value: entry.value,
        expiresAt: now() + SEGMENT_CACHE_TTL_MS,
      });
      return entry.value;
    },
    set(key: string, value: Value): void {
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + SEGMENT_CACHE_TTL_MS });
      while (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
  };
}

export function createSegmentCache(now: () => number): SegmentCache {
  const transcripts = createLru<SegmentTranscript>(now);
  const languages = createLru<RememberedLanguage>(now);
  return {
    transcript: (key) => transcripts.get(key),
    rememberTranscript: (key, transcript) => transcripts.set(key, transcript),
    language: (key) => languages.get(key),
    rememberLanguage: (key, remembered) => languages.set(key, remembered),
  };
}
