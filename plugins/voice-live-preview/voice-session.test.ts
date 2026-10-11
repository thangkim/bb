import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOUD_DRAFT_POLICY,
  LOCAL_DRAFT_POLICY,
  type DraftPolicy,
} from "./draft-scheduler.js";
import {
  createVoiceSession,
  type VoiceRecording,
  type VoiceSessionDeps,
  type VoiceTarget,
} from "./voice-session.js";

type Transcribe = VoiceSessionDeps["transcribe"];

function audioOf(text: string): File {
  return new File([text], "recording.webm", { type: "audio/webm" });
}

function fakeRecording(final = audioOf("everything")) {
  let failRecording: (error: unknown) => void = () => {};
  const recording: VoiceRecording = {
    startedAtMs: Date.now(),
    snapshot: vi.fn(() => audioOf("so far")),
    stop: vi.fn(async () => final),
    cancel: vi.fn(),
  };
  const startRecording = vi.fn(async (onFailure: (error: unknown) => void) => {
    failRecording = onFailure;
    return { ...recording, startedAtMs: Date.now() };
  });
  return {
    final,
    recording,
    startRecording,
    fail: (error: unknown) => failRecording(error),
  };
}

function setup(
  transcribe: Transcribe,
  options: {
    policy?: Promise<DraftPolicy>;
    startRecording?: VoiceSessionDeps["startRecording"];
  } = {},
) {
  const recorder = fakeRecording();
  const deps = {
    startRecording: options.startRecording ?? recorder.startRecording,
    transcribe: vi.fn(transcribe),
    draftPolicy: () => options.policy ?? Promise.resolve(CLOUD_DRAFT_POLICY),
    download: vi.fn(),
    notify: { error: vi.fn(), warning: vi.fn() },
    now: () => Date.now(),
  } satisfies VoiceSessionDeps;
  const session = createVoiceSession(deps);
  const inserted: string[] = [];
  const target: VoiceTarget = {
    promptContext: () => "Earlier draft",
    insert: (text) => inserted.push(text),
  };
  const drafts: string[] = [];
  session.subscribe(() => {
    const { draft } = session.getState();
    if (draft.length > 0 && drafts.at(-1) !== draft) drafts.push(draft);
  });
  return { deps, session, target, inserted, drafts, recorder };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("voice session", () => {
  it("previews drafts while recording and inserts the final transcript", async () => {
    const replies = ["Words so far", "Final words"];
    const { deps, session, target, inserted, drafts, recorder } = setup(
      async () => replies.shift() ?? "",
    );

    await session.start(target);
    expect(session.getState().phase).toBe("recording");
    await vi.advanceTimersByTimeAsync(2_999);
    expect(deps.transcribe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(drafts).toEqual(["Words so far"]);
    expect(deps.transcribe.mock.calls[0]?.[1]).toBe("Earlier draft");

    await session.stop();
    expect(inserted).toEqual(["Final words"]);
    expect(deps.transcribe.mock.calls.at(-1)?.[0]).toBe(recorder.final);
    expect(session.getState()).toEqual({ phase: "idle", draft: "" });
    expect(deps.notify.warning).not.toHaveBeenCalled();
  });

  it("drafts every second when the voice service runs locally", async () => {
    let count = 0;
    const { deps, session, target, drafts } = setup(
      async () => `draft ${++count}`,
      { policy: Promise.resolve(LOCAL_DRAFT_POLICY) },
    );

    await session.start(target);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(drafts).toEqual(["draft 1"]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(drafts).toEqual(["draft 1", "draft 2", "draft 3"]);
    expect(deps.transcribe).toHaveBeenCalledTimes(3);
    session.cancel();
  });

  it("transcribes without drafts when it stops before the schedule is known", async () => {
    const { deps, session, target, inserted, drafts } = setup(
      async () => "Final words",
      { policy: new Promise<DraftPolicy>(() => {}) },
    );

    await session.start(target);
    await vi.advanceTimersByTimeAsync(10_000);
    await session.stop();
    expect(inserted).toEqual(["Final words"]);
    expect(drafts).toEqual([]);
    expect(deps.transcribe).toHaveBeenCalledOnce();
  });

  it("waits for an in-flight draft before the final request", async () => {
    let finishDraft: ((text: string) => void) | undefined;
    let draftSignal: AbortSignal | undefined;
    const { deps, session, target, inserted } = setup(async () => "Final");
    deps.transcribe.mockImplementationOnce(
      (_audio, _prompt, signal) =>
        new Promise((resolve) => {
          draftSignal = signal;
          finishDraft = resolve;
        }),
    );
    await session.start(target);
    await vi.advanceTimersByTimeAsync(3_000);

    const stopped = session.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getState().phase).toBe("transcribing");
    expect(deps.transcribe).toHaveBeenCalledTimes(1);
    expect(draftSignal?.aborted).toBe(false);

    finishDraft?.("Draft");
    await stopped;
    expect(deps.transcribe).toHaveBeenCalledTimes(2);
    expect(inserted).toEqual(["Final"]);
  });

  it("retries a failed final once, then inserts the last draft with a warning", async () => {
    const { deps, session, target, inserted, recorder } = setup(async () => "");
    deps.transcribe
      .mockResolvedValueOnce("Words heard so far")
      .mockRejectedValue(new Error("HTTP 403: Cloudflare challenge"));
    await session.start(target);
    await vi.advanceTimersByTimeAsync(3_000);

    const stopped = session.stop();
    await vi.advanceTimersByTimeAsync(699);
    expect(deps.transcribe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await stopped;

    expect(deps.transcribe).toHaveBeenCalledTimes(3);
    expect(inserted).toEqual(["Words heard so far"]);
    const [title, options] = deps.notify.warning.mock.calls[0] ?? [];
    expect(title).toBe("Voice input used the live preview");
    expect(options).toMatchObject({
      description: "Cloudflare challenge",
      action: { label: "Download recording" },
    });
    options?.action?.onClick();
    expect(deps.download).toHaveBeenCalledWith(recorder.final);
  });

  it("reports the error with a download when the final fails and no draft exists", async () => {
    const { deps, session, target, inserted } = setup(async () => {
      throw new Error("offline");
    });
    await session.start(target);
    await vi.advanceTimersByTimeAsync(1_500);

    const stopped = session.stop();
    await vi.advanceTimersByTimeAsync(700);
    await stopped;
    expect(inserted).toEqual([]);
    expect(deps.notify.error).toHaveBeenCalledWith(
      "Voice input failed",
      expect.objectContaining({
        description: "offline",
        action: expect.objectContaining({ label: "Download recording" }),
      }),
    );
  });

  it("cancels the recording, aborts the in-flight draft and stops drafting", async () => {
    let draftSignal: AbortSignal | undefined;
    const { deps, session, target, inserted, recorder } = setup(
      (_audio, _prompt, signal) =>
        new Promise<string>(() => {
          draftSignal = signal;
        }),
    );
    await session.start(target);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(session.cancel()).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(draftSignal?.aborted).toBe(true);
    expect(recorder.recording.cancel).toHaveBeenCalled();
    expect(deps.transcribe).toHaveBeenCalledOnce();
    expect(inserted).toEqual([]);
    expect(session.getState().phase).toBe("idle");
    expect(session.cancel()).toBe(false);
  });

  it("cancels the final transcription without inserting anything", async () => {
    let finalSignal: AbortSignal | undefined;
    const { session, target, inserted, deps } = setup(
      (_audio, _prompt, signal) =>
        new Promise<string>((_resolve, reject) => {
          finalSignal = signal;
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
      { policy: new Promise<DraftPolicy>(() => {}) },
    );
    await session.start(target);
    await vi.advanceTimersByTimeAsync(2_000);
    const stopped = session.stop();
    await vi.advanceTimersByTimeAsync(0);

    session.cancel();
    await stopped;
    expect(finalSignal?.aborted).toBe(true);
    expect(inserted).toEqual([]);
    expect(deps.notify.error).not.toHaveBeenCalled();
  });

  it("rejects recordings shorter than a second", async () => {
    const { deps, session, target, inserted } = setup(async () => "hi");
    await session.start(target);
    await vi.advanceTimersByTimeAsync(400);
    await session.stop();
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
    expect(deps.notify.error).toHaveBeenCalledWith(
      "Recording too short (minimum 1 second)",
    );
  });

  it("explains why the microphone did not start", async () => {
    const { deps, session, target } = setup(async () => "", {
      startRecording: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
    });
    await session.start(target);
    expect(session.getState().phase).toBe("idle");
    expect(deps.notify.error).toHaveBeenCalledWith("Voice input failed", {
      description: "Microphone permission denied",
    });
  });

  it("releases a microphone that finishes starting after cancel", async () => {
    let resolveStart: ((recording: VoiceRecording) => void) | undefined;
    const recorder = fakeRecording();
    const { session, target } = setup(async () => "", {
      startRecording: () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
    });
    const started = session.toggle(target);
    expect(session.getState().phase).toBe("starting");
    await session.toggle(target);
    expect(session.getState().phase).toBe("idle");

    resolveStart?.(recorder.recording);
    await started;
    expect(recorder.recording.cancel).toHaveBeenCalled();
    expect(session.getState().phase).toBe("idle");
  });

  it("keeps the words heard so far when the recorder fails mid-recording", async () => {
    const { deps, session, target, inserted, recorder } = setup(
      async () => "Words so far",
    );
    await session.start(target);
    await vi.advanceTimersByTimeAsync(3_000);

    recorder.fail(new Error("Voice recording failed"));
    expect(inserted).toEqual(["Words so far"]);
    expect(deps.notify.warning).toHaveBeenCalledWith(
      "Voice input used the live preview",
      expect.objectContaining({ description: "Voice recording failed" }),
    );
    expect(session.getState().phase).toBe("idle");
  });

  it("offers the transcript and recording when it cannot be inserted", async () => {
    const { deps, session, target } = setup(async () => "Lost words", {
      policy: new Promise<DraftPolicy>(() => {}),
    });
    await session.start({
      ...target,
      insert: () => {
        throw new Error("Composer is not on screen");
      },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await session.stop();
    expect(deps.notify.error).toHaveBeenCalledWith(
      "Couldn't insert the transcript",
      expect.objectContaining({
        description: "Composer is not on screen: Lost words",
        action: expect.objectContaining({ label: "Download recording" }),
      }),
    );
  });
});
