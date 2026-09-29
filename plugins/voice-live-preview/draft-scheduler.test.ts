import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOUD_DRAFT_POLICY,
  LOCAL_DRAFT_POLICY,
  createDraftScheduler,
  type DraftPolicy,
  type DraftSchedulerDeps,
} from "./draft-scheduler.js";

let startedAt = 0;

function recordingScheduler(
  request: DraftSchedulerDeps["request"],
  recordedMs: () => number = () => Date.now() - startedAt,
  policy: DraftPolicy = CLOUD_DRAFT_POLICY,
) {
  const drafts: string[] = [];
  const scheduler = createDraftScheduler({
    policy,
    now: () => Date.now(),
    recordedMs,
    request,
    onDraft: (text) => drafts.push(text),
  });
  startedAt = Date.now();
  scheduler.start(startedAt);
  return { scheduler, drafts };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDraftScheduler", () => {
  it("sends the first draft after 3s and grows the gap by 1.4x", async () => {
    const replies = ["Привет", "Привет,   это тест"];
    const request = vi.fn(
      async (_signal: AbortSignal) => replies.shift() ?? "",
    );
    const { scheduler, drafts } = recordingScheduler(request);

    await vi.advanceTimersByTimeAsync(2_900);
    expect(request).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(request).toHaveBeenCalledTimes(1);
    expect(drafts).toEqual(["Привет"]);

    await vi.advanceTimersByTimeAsync(4_199);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(drafts).toEqual(["Привет", "Привет, это тест"]);
    expect(scheduler.lastDraft()).toBe("Привет, это тест");

    await vi.advanceTimersByTimeAsync(5_880);
    expect(request).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it("caps the gap at 8s", async () => {
    const request = vi.fn(async () => "words");
    const { scheduler } = recordingScheduler(request);
    const times: number[] = [];
    request.mockImplementation(async () => {
      times.push(Date.now() - startedAt);
      return "words";
    });

    await vi.advanceTimersByTimeAsync(60_000);

    const gaps = times.slice(1).map((time, index) => time - times[index]!);
    expect(gaps).toEqual([4_200, 5_880, 8_000, 8_000, 8_000, 8_000, 8_000]);
    scheduler.stop();
  });

  it("waits for at least 2.5s of new audio before re-sending", async () => {
    let recorded = 3_000;
    const request = vi.fn(async (_signal: AbortSignal) => "words");
    const { scheduler } = recordingScheduler(request, () => recorded);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(request).toHaveBeenCalledTimes(1);

    recorded = 5_250;
    await vi.advanceTimersByTimeAsync(4_200);
    expect(request).toHaveBeenCalledTimes(1);

    recorded = 5_500;
    await vi.advanceTimersByTimeAsync(4_200);
    expect(request).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("stops drafting silently after one failed draft", async () => {
    const request = vi.fn(async () => {
      throw new Error("HTTP 403: Cloudflare challenge");
    });
    const { scheduler, drafts } = recordingScheduler(request);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(request).toHaveBeenCalledTimes(1);
    expect(drafts).toEqual([]);
    expect(scheduler.lastDraft()).toBe("");
  });

  it("aborts a draft after 4s and sends no more", async () => {
    let signal: AbortSignal | undefined;
    const request = vi.fn(
      (nextSignal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal = nextSignal;
          nextSignal.addEventListener("abort", () => reject(nextSignal.reason));
        }),
    );
    recordingScheduler(request);

    await vi.advanceTimersByTimeAsync(3_000 + 3_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("never overlaps requests", async () => {
    let finish: ((text: string) => void) | undefined;
    const request = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const { scheduler } = recordingScheduler(request);

    await vi.advanceTimersByTimeAsync(3_000 + 3_500);
    expect(request).toHaveBeenCalledTimes(1);

    finish?.("words");
    await vi.advanceTimersByTimeAsync(4_200);
    expect(request).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("sends at most 12 drafts", async () => {
    const request = vi.fn(async () => "words");
    recordingScheduler(request);

    await vi.advanceTimersByTimeAsync(170_000);

    expect(request).toHaveBeenCalledTimes(12);
  });

  it("sends no draft after 180s of recording", async () => {
    const request = vi.fn(async () => "words");
    let recorded = 0;
    const { scheduler } = recordingScheduler(request, () => recorded);

    await vi.advanceTimersByTimeAsync(181_000);
    expect(request).not.toHaveBeenCalled();

    recorded = 250_000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("lets an in-flight draft finish after halt and aborts it on stop", async () => {
    let finish: ((text: string) => void) | undefined;
    const signals: AbortSignal[] = [];
    const request = vi.fn(
      (signal: AbortSignal) =>
        new Promise<string>((resolve) => {
          signals.push(signal);
          finish = resolve;
        }),
    );
    const { scheduler, drafts } = recordingScheduler(request);
    await vi.advanceTimersByTimeAsync(3_000);

    scheduler.halt();
    let settled = false;
    void scheduler.settled().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    expect(signals[0]?.aborted).toBe(false);

    finish?.("late words");
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(drafts).toEqual(["late words"]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(request).toHaveBeenCalledTimes(1);

    scheduler.start(Date.now());
    startedAt = Date.now();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(scheduler.lastDraft()).toBe("");
    scheduler.stop();
    expect(signals[1]?.aborted).toBe(true);
  });

  describe("for a service that runs locally", () => {
    const elapsed = () => Date.now() - startedAt;

    it("sends a draft every second from the first second", async () => {
      const request = vi.fn(async () => "draft");
      const { scheduler } = recordingScheduler(
        request,
        elapsed,
        LOCAL_DRAFT_POLICY,
      );

      await vi.advanceTimersByTimeAsync(999);
      expect(request).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(request).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(9_000);
      expect(request).toHaveBeenCalledTimes(10);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(request).toHaveBeenCalledTimes(70);
      scheduler.stop();
    });

    it("sends the next draft as soon as a slow one returns", async () => {
      const sentAt: number[] = [];
      const request = vi.fn(async () => {
        sentAt.push(Date.now() - startedAt);
        await new Promise((resolve) => setTimeout(resolve, 1_600));
        return "draft";
      });
      const { scheduler } = recordingScheduler(
        request,
        elapsed,
        LOCAL_DRAFT_POLICY,
      );

      await vi.advanceTimersByTimeAsync(6_000);

      expect(sentAt).toHaveLength(4);
      expect(sentAt[0]).toBe(1_000);
      for (let index = 1; index < sentAt.length; index += 1) {
        const gap = sentAt[index]! - sentAt[index - 1]!;
        expect(gap).toBeGreaterThanOrEqual(1_600);
        expect(gap).toBeLessThan(1_610);
      }
      scheduler.stop();
    });

    it("keeps drafting through two failures and stops after three in a row", async () => {
      const outcomes = [false, false, true, false, false, false];
      const request = vi.fn(async () => {
        if (outcomes.shift() === false) throw new Error("model loading");
        return "draft";
      });
      const { scheduler, drafts } = recordingScheduler(
        request,
        elapsed,
        LOCAL_DRAFT_POLICY,
      );

      await vi.advanceTimersByTimeAsync(30_000);

      expect(request).toHaveBeenCalledTimes(6);
      expect(drafts).toEqual(["draft"]);
      scheduler.stop();
    });
  });
});
