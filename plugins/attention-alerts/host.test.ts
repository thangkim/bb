import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { describe, expect, it } from "vitest";
import { createAttentionAlertsHostEntry } from "./host.js";
import { encodeWav, renderSound, SOUND_SAMPLE_RATE } from "./sounds.js";

function fakeDeps(platform: NodeJS.Platform, plays = true) {
  const files = new Map<string, Uint8Array>();
  const runs: { command: string; args: readonly string[] }[] = [];
  return {
    files,
    runs,
    deps: {
      platform,
      writeFile: async (path: string, data: Uint8Array) => {
        files.set(path, data);
      },
      mkdir: async () => undefined,
      run: async (command: string, args: readonly string[]) => {
        runs.push({ command, args });
        return plays;
      },
    },
  };
}

const paths = { dataDir: "/data", tempDir: "/tmp/worker" };

describe("Mac fallback sound", () => {
  it("writes each sound once and plays it with afplay at the given volume", async () => {
    const fake = fakeDeps("darwin");
    const harness = experimental_createHostEntryHarness(
      createAttentionAlertsHostEntry(fake.deps),
      { experimental_paths: paths },
    );

    expect(
      await harness.experimental_call("playSound", {
        sound: "attention",
        volume: 0.8,
      }),
    ).toEqual({ played: true });
    await harness.experimental_call("playSound", {
      sound: "attention",
      volume: 0.25,
    });

    expect([...fake.files.keys()]).toEqual([
      "/tmp/worker/attention-attention.wav",
    ]);
    expect(fake.runs).toEqual([
      {
        command: "/usr/bin/afplay",
        args: ["-v", "0.80", "/tmp/worker/attention-attention.wav"],
      },
      {
        command: "/usr/bin/afplay",
        args: ["-v", "0.25", "/tmp/worker/attention-attention.wav"],
      },
    ]);
    await harness.experimental_dispose();
  });

  it("reports that nothing played off macOS or when afplay fails", async () => {
    const linux = fakeDeps("linux");
    const linuxHarness = experimental_createHostEntryHarness(
      createAttentionAlertsHostEntry(linux.deps),
      { experimental_paths: paths },
    );
    expect(
      await linuxHarness.experimental_call("playSound", {
        sound: "done",
        volume: 1,
      }),
    ).toEqual({ played: false });
    expect(linux.runs).toEqual([]);
    await linuxHarness.experimental_dispose();

    const failing = fakeDeps("darwin", false);
    const failingHarness = experimental_createHostEntryHarness(
      createAttentionAlertsHostEntry(failing.deps),
      { experimental_paths: paths },
    );
    expect(
      await failingHarness.experimental_call("playSound", {
        sound: "error",
        volume: 1,
      }),
    ).toEqual({ played: false });
    await failingHarness.experimental_dispose();
  });
});

describe("synthesized sounds", () => {
  it("renders audible, unclipped, distinct sounds and a valid WAV", () => {
    const attention = renderSound("attention");
    const done = renderSound("done");
    const peak = attention.reduce(
      (max, sample) => Math.max(max, Math.abs(sample)),
      0,
    );
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThanOrEqual(0.95);
    expect(attention.length).not.toBe(done.length);

    const wav = encodeWav(done);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(SOUND_SAMPLE_RATE);
    expect(view.getUint32(40, true)).toBe(done.length * 2);
  });
});
