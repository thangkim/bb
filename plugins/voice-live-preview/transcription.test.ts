import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FINAL_RETRY_DELAY_MS,
  describeVoiceError,
  runFinalTranscription,
} from "./transcription.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runFinalTranscription", () => {
  it("returns the normalized transcript without retrying", async () => {
    const transcribe = vi.fn(async () => "  Final   words ");
    const outcome = await runFinalTranscription({
      transcribe,
      signal: new AbortController().signal,
      lastDraft: () => "draft",
    });
    expect(outcome).toEqual({ kind: "transcript", text: "Final words" });
    expect(transcribe).toHaveBeenCalledOnce();
  });

  it("retries a failed request once after 700ms", async () => {
    const transcribe = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(new Error("HTTP 403: blocked"))
      .mockResolvedValueOnce("Second try");
    const pending = runFinalTranscription({
      transcribe,
      signal: new AbortController().signal,
      lastDraft: () => "",
    });

    await vi.advanceTimersByTimeAsync(FINAL_RETRY_DELAY_MS - 1);
    expect(transcribe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual({
      kind: "transcript",
      text: "Second try",
    });
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it("falls back to the last draft when both attempts fail", async () => {
    const error = new Error("HTTP 403: Cloudflare challenge");
    const transcribe = vi.fn(async () => {
      throw error;
    });
    const pending = runFinalTranscription({
      transcribe,
      signal: new AbortController().signal,
      lastDraft: () => "Words heard so far",
    });
    await vi.advanceTimersByTimeAsync(FINAL_RETRY_DELAY_MS);

    await expect(pending).resolves.toEqual({
      kind: "fallback",
      text: "Words heard so far",
      error,
    });
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it("fails when both attempts fail and no draft exists", async () => {
    const transcribe = vi.fn(async () => "   ");
    const pending = runFinalTranscription({
      transcribe,
      signal: new AbortController().signal,
      lastDraft: () => "",
    });
    await vi.advanceTimersByTimeAsync(FINAL_RETRY_DELAY_MS);

    const outcome = await pending;
    expect(outcome.kind).toBe("failed");
    expect(outcome.kind === "failed" && describeVoiceError(outcome.error)).toBe(
      "Voice transcription returned an empty result.",
    );
  });

  it("stops without retrying once cancelled", async () => {
    const controller = new AbortController();
    const transcribe = vi.fn(async () => {
      throw new Error("network");
    });
    const pending = runFinalTranscription({
      transcribe,
      signal: controller.signal,
      lastDraft: () => "draft",
    });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();

    await expect(pending).resolves.toEqual({ kind: "cancelled" });
    expect(transcribe).toHaveBeenCalledTimes(1);
  });
});

describe("describeVoiceError", () => {
  it("strips HTTP prefixes and HTML documents", () => {
    expect(
      describeVoiceError(
        new Error("HTTP 403: Blocked <!DOCTYPE html><html>challenge</html>"),
      ),
    ).toBe("Blocked");
  });

  it("names microphone failures", () => {
    expect(
      describeVoiceError(new DOMException("denied", "NotAllowedError")),
    ).toBe("Microphone permission denied");
    expect(
      describeVoiceError(new DOMException("missing", "NotFoundError"), true),
    ).toBe("Selected microphone was not found");
  });
});
