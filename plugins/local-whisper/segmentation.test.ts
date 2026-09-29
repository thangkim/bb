import { describe, expect, it } from "vitest";
import {
  SAMPLE_RATE,
  findSpeechSegments,
  wavFromSamples,
} from "./segmentation.js";

function samplesFor(
  parts: ReadonlyArray<[kind: "speech" | "pause", ms: number]>,
) {
  const lengths = parts.map(([, ms]) => Math.round((ms * SAMPLE_RATE) / 1000));
  const samples = new Int16Array(
    lengths.reduce((sum, length) => sum + length, 0),
  );
  let offset = 0;
  parts.forEach(([kind], index) => {
    const length = lengths[index]!;
    if (kind === "speech") {
      for (let i = 0; i < length; i += 1) {
        samples[offset + i] = i % 2 === 0 ? 3000 : -3000;
      }
    }
    offset += length;
  });
  return samples;
}

const seconds = (segment: { start: number; end: number }) => [
  segment.start / SAMPLE_RATE,
  segment.end / SAMPLE_RATE,
];

describe("findSpeechSegments", () => {
  it("splits at sentence pauses and pads each segment without overlapping", () => {
    const segments = findSpeechSegments(
      samplesFor([
        ["pause", 1000],
        ["speech", 1500],
        ["pause", 600],
        ["speech", 1500],
      ]),
    );

    const expected = [
      [0.8, 2.7],
      [2.9, 4.6],
    ];
    expect(segments).toHaveLength(expected.length);
    segments.map(seconds).forEach(([start, end], index) => {
      expect(Math.abs(start! - expected[index]![0]!)).toBeLessThanOrEqual(0.03);
      expect(Math.abs(end! - expected[index]![1]!)).toBeLessThanOrEqual(0.03);
    });
  });

  it("merges a blip shorter than 300ms into the following sentence", () => {
    const segments = findSpeechSegments(
      samplesFor([
        ["speech", 200],
        ["pause", 700],
        ["speech", 1500],
      ]),
    );

    expect(segments.map(seconds)).toEqual([[0, 2.4]]);
  });

  it("keeps a short final burst as its own segment", () => {
    expect(
      findSpeechSegments(
        samplesFor([
          ["speech", 1500],
          ["pause", 700],
          ["speech", 300],
        ]),
      ),
    ).toHaveLength(2);
  });

  it("finds nothing in silence or low background noise", () => {
    const noise = new Int16Array(SAMPLE_RATE).map((_, i) =>
      i % 2 === 0 ? 100 : -100,
    );
    expect(findSpeechSegments(noise)).toEqual([]);
  });
});

describe("wavFromSamples", () => {
  it("writes a 16 kHz mono PCM header ahead of the samples", () => {
    const wav = wavFromSamples(Int16Array.from([1, -1, 2]));
    const view = new DataView(wav.buffer);

    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(view.getUint32(40, true)).toBe(6);
    expect(Array.from(new Int16Array(wav.buffer, 44))).toEqual([1, -1, 2]);
  });
});
