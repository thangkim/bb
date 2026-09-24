import { Buffer } from "node:buffer";
import { setAiServiceSelection } from "@bb/db";
import { describe, expect, it, vi } from "vitest";
import {
  resolveVoiceTranscriptionEnabled,
  transcribeVoiceInput,
} from "../../src/services/ai/voice-transcription.js";
import { registerFakeAiService } from "../helpers/ai-services.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function voiceFile(size = 5): File {
  return new File([Buffer.alloc(size, 1)], "prompt.webm", {
    type: "audio/webm",
  });
}

function registerCodexVoice(
  harness: TestAppHarness,
  transcribe: (audio: File) => Promise<string>,
) {
  return registerFakeAiService(harness.deps.aiServices, {
    id: "codex",
    pluginId: "provider-codex",
    builtin: true,
    transcribe,
  });
}

async function postVoice(
  harness: TestAppHarness,
  file: File,
  prompt?: string,
): Promise<Response> {
  const form = new FormData();
  form.set("file", file);
  if (prompt !== undefined) form.set("prompt", prompt);
  return harness.app.request("/api/v1/system/voice-transcription", {
    body: form,
    method: "POST",
  });
}

describe("voice transcription", () => {
  it("rejects empty and oversized audio before calling a service", async () => {
    await withTestHarness({}, async (harness) => {
      const codex = registerCodexVoice(harness, async () => "unused");

      const empty = await postVoice(harness, voiceFile(0));
      expect(empty.status).toBe(400);
      await expect(empty.json()).resolves.toMatchObject({
        code: "invalid_request",
        message: "Audio file must not be empty",
      });
      const huge = await postVoice(harness, voiceFile(25 * 1024 * 1024 + 1));
      expect(huge.status).toBe(400);
      expect(codex.transcribeCalls).toHaveLength(0);
    });
  });

  it("passes the audio file and trimmed hint to the selected service", async () => {
    await withTestHarness({}, async (harness) => {
      const codex = registerCodexVoice(harness, async () => "  hello there \n");

      const response = await postVoice(harness, voiceFile(), "  bb, Codex  ");
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ text: "hello there" });
      expect(codex.transcribeCalls).toHaveLength(1);
      expect(codex.transcribeCalls[0]?.audio.name).toBe("prompt.webm");
      expect(codex.transcribeCalls[0]?.options.hint).toBe("bb, Codex");
    });
  });

  it("maps outcomes to API errors", async () => {
    await withTestHarness({}, async (harness) => {
      await expect(
        transcribeVoiceInput(harness.deps, {
          file: voiceFile(),
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({
        status: 501,
        body: { code: "not_configured" },
      });

      registerCodexVoice(harness, async () => {
        throw new Error("Codex rejected the audio");
      });
      await expect(
        transcribeVoiceInput(harness.deps, {
          file: voiceFile(),
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({
        status: 502,
        body: { code: "provider_rpc_error" },
      });

      setAiServiceSelection(harness.deps.db, "voice", { mode: "off" });
      await expect(
        transcribeVoiceInput(harness.deps, {
          file: voiceFile(),
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ status: 501 });
    });
  });

  it("aborts the service's signal when the request is cancelled", async () => {
    await withTestHarness({}, async (harness) => {
      const controller = new AbortController();
      let serviceSignal: AbortSignal | undefined;
      registerFakeAiService(harness.deps.aiServices, {
        id: "codex",
        pluginId: "provider-codex",
        builtin: true,
        transcribe: (_audio, { signal }) => {
          serviceSignal = signal;
          return new Promise<string>(() => undefined);
        },
      });

      const pending = transcribeVoiceInput(harness.deps, {
        file: voiceFile(),
        signal: controller.signal,
      });
      await vi.waitFor(() => expect(serviceSignal).toBeDefined());
      controller.abort();

      await expect(pending).rejects.toMatchObject({
        status: 400,
        body: { code: "cancelled" },
      });
      expect(serviceSignal?.aborted).toBe(true);
    });
  });

  it("gives a draft a shorter budget than the final transcription", async () => {
    await withTestHarness({}, async (harness) => {
      registerCodexVoice(harness, () => new Promise<string>(() => undefined));
      await harness.deps.aiServices.status({
        pluginId: "provider-codex",
        serviceId: "codex",
      });

      vi.useFakeTimers();
      try {
        const draft = transcribeVoiceInput(harness.deps, {
          file: voiceFile(),
          draft: true,
          signal: new AbortController().signal,
        });
        const final = transcribeVoiceInput(harness.deps, {
          file: voiceFile(),
          signal: new AbortController().signal,
        });
        const draftOutcome = draft.then(
          () => null,
          (error: unknown) => error,
        );
        let finalSettled = false;
        const finalOutcome = final.then(
          () => null,
          (error: unknown) => {
            finalSettled = true;
            return error;
          },
        );

        await vi.advanceTimersByTimeAsync(4_100);
        expect(await draftOutcome).toMatchObject({
          status: 504,
          body: { code: "transcription_timeout" },
        });
        expect(finalSettled).toBe(false);

        await vi.advanceTimersByTimeAsync(6_000);
        expect(await finalOutcome).toMatchObject({ status: 504 });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("retries a failed final transcription once, and never retries a draft", async () => {
    await withTestHarness({}, async (harness) => {
      let calls = 0;
      let failNext = true;
      registerCodexVoice(harness, async () => {
        calls += 1;
        if (failNext) {
          failNext = false;
          throw new Error("chatgpt.com answered with a Cloudflare challenge");
        }
        return "Привет";
      });

      const final = await postVoice(harness, voiceFile());
      expect(final.status).toBe(200);
      await expect(final.json()).resolves.toEqual({ text: "Привет" });
      expect(calls).toBe(2);

      calls = 0;
      failNext = true;
      const form = new FormData();
      form.set("file", voiceFile());
      form.set("draft", "true");
      const draft = await harness.app.request(
        "/api/v1/system/voice-transcription",
        { body: form, method: "POST" },
      );
      expect(draft.status).toBe(502);
      expect(calls).toBe(1);
    });
  });

  it("accepts the draft flag over the route", async () => {
    await withTestHarness({}, async (harness) => {
      const codex = registerCodexVoice(harness, async () => "Привет");
      const form = new FormData();
      form.set("file", voiceFile());
      form.set("draft", "true");
      const response = await harness.app.request(
        "/api/v1/system/voice-transcription",
        { body: form, method: "POST" },
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ text: "Привет" });
      expect(codex.transcribeCalls).toHaveLength(1);
    });
  });

  it("enables the microphone only when the voice task has a ready service", async () => {
    await withTestHarness({}, async (harness) => {
      expect(resolveVoiceTranscriptionEnabled(harness.deps)).toBe(false);
      registerCodexVoice(harness, async () => "hi");
      await harness.deps.aiServices.status({
        pluginId: "provider-codex",
        serviceId: "codex",
      });
      expect(resolveVoiceTranscriptionEnabled(harness.deps)).toBe(true);
      setAiServiceSelection(harness.deps.db, "voice", { mode: "off" });
      expect(resolveVoiceTranscriptionEnabled(harness.deps)).toBe(false);
    });
  });
});
