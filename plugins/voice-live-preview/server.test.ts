import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin, { parseLocalVoiceServices } from "./server.js";

async function draftCadence(
  voice: unknown,
  settings: Record<string, string> = {},
) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "voice-live-preview",
    settings,
  });
  harness.sdk.stub("system.aiServices", () => ({
    selections: {
      "thread-title": { mode: "automatic" },
      "commit-message": { mode: "automatic" },
      voice,
    },
    services: [],
  }));
  await plugin(bb);
  return harness.callRpc("draftCadence", null);
}

describe("draftCadence", () => {
  it("reports Local Whisper as local", async () => {
    await expect(
      draftCadence({
        mode: "service",
        pluginId: "local-whisper",
        serviceId: "local-whisper",
      }),
    ).resolves.toEqual({ local: true });
  });

  it("keeps the cloud schedule for Automatic, Off, and other services", async () => {
    await expect(draftCadence({ mode: "automatic" })).resolves.toEqual({
      local: false,
    });
    await expect(draftCadence({ mode: "off" })).resolves.toEqual({
      local: false,
    });
    await expect(
      draftCadence({
        mode: "service",
        pluginId: "provider-codex",
        serviceId: "codex",
      }),
    ).resolves.toEqual({ local: false });
  });

  it("uses the configured list of local services", async () => {
    await expect(
      draftCadence(
        { mode: "service", pluginId: "my-voice", serviceId: "fast" },
        { localVoiceServices: "local-whisper/local-whisper, my-voice/fast" },
      ),
    ).resolves.toEqual({ local: true });
  });
});

describe("parseLocalVoiceServices", () => {
  it("rejects entries that are not plugin-id/service-id pairs", () => {
    expect(parseLocalVoiceServices("")).toEqual([]);
    expect(parseLocalVoiceServices("local-whisper")).toBeNull();
    expect(parseLocalVoiceServices("a/b/c")).toBeNull();
  });
});
