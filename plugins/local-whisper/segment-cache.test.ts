import { describe, expect, it } from "vitest";
import {
  RECORDING_ID_SAMPLES,
  SEGMENT_CACHE_TTL_MS,
  createSegmentCache,
  recordingKey,
  segmentKey,
} from "./segment-cache.js";

const LANGUAGES = ["en", "ru", "vi"];

function speech(seed: number, length: number): Int16Array {
  return Int16Array.from(
    { length },
    (_, index) => ((index * seed) % 2000) - 1000,
  );
}

describe("recordingKey", () => {
  it("stays the same while a recording grows and differs between recordings", () => {
    const draft = speech(7, RECORDING_ID_SAMPLES + 100);
    const longer = new Int16Array(RECORDING_ID_SAMPLES * 20);
    longer.set(draft);

    expect(recordingKey(longer, LANGUAGES)).toBe(
      recordingKey(draft, LANGUAGES),
    );
    expect(recordingKey(speech(11, RECORDING_ID_SAMPLES), LANGUAGES)).not.toBe(
      recordingKey(draft, LANGUAGES),
    );
    expect(recordingKey(draft, ["en", "vi"])).not.toBe(
      recordingKey(draft, LANGUAGES),
    );
    expect(
      recordingKey(speech(7, RECORDING_ID_SAMPLES - 1), LANGUAGES),
    ).toBeNull();
  });
});

describe("segment cache", () => {
  it("separates transcripts by language settings and hint", () => {
    const samples = speech(3, 1000);
    expect(segmentKey(samples, { languages: ["en"], hint: null })).not.toBe(
      segmentKey(samples, { languages: ["en", "vi"], hint: null }),
    );
    expect(segmentKey(samples, { languages: ["en"], hint: null })).not.toBe(
      segmentKey(samples, { languages: ["en"], hint: "bb" }),
    );
  });

  it("forgets entries that have not been used recently", () => {
    let now = 0;
    const cache = createSegmentCache(() => now);
    cache.rememberTranscript("key", { text: "hello", language: "en" });
    cache.rememberLanguage("key", { language: "en", reliable: true });

    now = SEGMENT_CACHE_TTL_MS;

    expect(cache.transcript("key")).toBeNull();
    expect(cache.language("key")).toBeNull();
  });
});
