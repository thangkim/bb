// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import type {
  ExperimentalComposerProvisionalText,
  ExperimentalComposerVoiceSession,
} from "@get-bb/plugin-sdk/app";
import { createDictateCommand } from "./app.js";
import {
  CLOUD_DRAFT_POLICY,
  LOCAL_DRAFT_POLICY,
  type DraftPolicy,
} from "./draft-scheduler.js";
import { startLiveVoiceSession } from "./live-session.js";
import { toggleNativeDictation, trackFocusedComposer } from "./native-mic.js";

const app = await loadPluginApp(() => import("./app"));

type Transcribe = ExperimentalComposerVoiceSession["transcribe"];

function recordingOf(text: string): File {
  return new File([text], "recording.webm", { type: "audio/webm" });
}

function fakeSession(
  transcribe: Transcribe,
  options: { policy?: Promise<DraftPolicy> } = {},
) {
  const controller = new AbortController();
  const previews: string[] = [];
  const provisionalText: ExperimentalComposerProvisionalText = {
    update: (text) => previews.push(text),
    commit: vi.fn(),
    cancel: vi.fn(),
  };
  const session: ExperimentalComposerVoiceSession = {
    readRecording: () => recordingOf("so far"),
    transcribe: vi.fn(transcribe),
    provisionalText,
    signal: controller.signal,
  };
  const warning = vi.fn();
  const recording = startLiveVoiceSession(
    session,
    { warning },
    options.policy ?? Promise.resolve(CLOUD_DRAFT_POLICY),
  );
  return { controller, previews, session, recording, warning };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("registration", () => {
  it("joins bb's native voice input in every composer", () => {
    expect(app.composerCustomizations).toHaveLength(1);
    const customization = app.composerCustomizations[0]!;
    expect(customization.id).toBe("voice-live-preview");
    expect(customization.scopes).toBeUndefined();
    expect(typeof customization.experimental_voiceInput?.start).toBe(
      "function",
    );
    expect(customization.actions).toBeUndefined();
    expect(app.contentScripts.map((script) => script.id)).toEqual([
      "composer-focus",
    ]);
  });

  it("binds Control+V by default only on macOS", () => {
    expect(createDictateCommand(true)).toMatchObject({
      id: "dictate",
      title: "Voice: dictate into the composer",
      defaultShortcut: { key: "v", control: true },
    });
    expect(createDictateCommand(false).defaultShortcut).toBeUndefined();
  });
});

describe("live voice session", () => {
  it("previews drafts and returns the final transcript", async () => {
    const replies = ["Words so far", "Final words"];
    const { recording, previews, session } = fakeSession(
      async () => replies.shift() ?? "",
    );

    await vi.advanceTimersByTimeAsync(2_999);
    expect(session.transcribe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(previews).toEqual(["Words so far"]);

    const final = recordingOf("everything");
    await expect(recording.finish(final)).resolves.toBe("Final words");
    expect(vi.mocked(session.transcribe).mock.calls.at(-1)?.[0]).toBe(final);
  });

  it("drafts every second when the voice service runs locally", async () => {
    const { recording, previews, session } = fakeSession(
      async () => `draft ${previews.length + 1}`,
      { policy: Promise.resolve(LOCAL_DRAFT_POLICY) },
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(previews).toEqual(["draft 1"]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(previews).toEqual(["draft 1", "draft 2", "draft 3"]);
    expect(session.transcribe).toHaveBeenCalledTimes(3);

    await recording.finish(recordingOf("everything"));
  });

  it("transcribes the final recording without drafts when it stops before the schedule is known", async () => {
    const { recording, previews, session } = fakeSession(
      async () => "Final words",
      { policy: new Promise<DraftPolicy>(() => {}) },
    );

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(recording.finish(recordingOf("everything"))).resolves.toBe(
      "Final words",
    );
    expect(previews).toEqual([]);
    expect(session.transcribe).toHaveBeenCalledOnce();
  });

  it("waits for an in-flight draft before the final request", async () => {
    let finishDraft: ((text: string) => void) | undefined;
    let draftSignal: AbortSignal | undefined;
    const transcribe = vi
      .fn<Transcribe>()
      .mockImplementationOnce(
        (_audio, { signal }) =>
          new Promise((resolve) => {
            draftSignal = signal;
            finishDraft = resolve;
          }),
      )
      .mockResolvedValue("Final");
    const { recording, session } = fakeSession(transcribe);
    await vi.advanceTimersByTimeAsync(3_000);

    const final = recording.finish(recordingOf("all"));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.transcribe).toHaveBeenCalledTimes(1);
    expect(draftSignal?.aborted).toBe(false);

    finishDraft?.("Draft");
    await expect(final).resolves.toBe("Final");
    expect(session.transcribe).toHaveBeenCalledTimes(2);
  });

  it("retries a failed final once, then falls back to the last draft with a warning", async () => {
    const transcribe = vi
      .fn<Transcribe>()
      .mockResolvedValueOnce("Words heard so far")
      .mockRejectedValue(new Error("HTTP 403: Cloudflare challenge"));
    const { recording, warning, session } = fakeSession(transcribe);
    await vi.advanceTimersByTimeAsync(3_000);

    const final = recording.finish(recordingOf("all"));
    await vi.advanceTimersByTimeAsync(699);
    expect(session.transcribe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    await expect(final).resolves.toBe("Words heard so far");
    expect(session.transcribe).toHaveBeenCalledTimes(3);
    const [title, options] = warning.mock.calls[0] ?? [];
    expect(title).toBe("Voice input used the live preview");
    expect(options).toMatchObject({
      description: "Cloudflare challenge",
      action: { label: "Download recording" },
    });
  });

  it("rejects with the error when the final fails twice and no draft exists", async () => {
    const error = new Error("offline");
    const { recording, warning } = fakeSession(async () => {
      throw error;
    });

    const final = recording.finish(recordingOf("short"));
    const assertion = expect(final).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(700);
    await assertion;
    expect(warning).not.toHaveBeenCalled();
  });

  it("aborts an in-flight draft and stops drafting when the session ends", async () => {
    let draftSignal: AbortSignal | undefined;
    const { controller, session } = fakeSession(
      (_audio, { signal }) =>
        new Promise<string>(() => {
          draftSignal = signal;
        }),
    );
    await vi.advanceTimersByTimeAsync(3_000);

    controller.abort();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(draftSignal?.aborted).toBe(true);
    expect(session.transcribe).toHaveBeenCalledOnce();
  });
});

function composer(options: { voiceActive?: boolean } = {}) {
  const form = document.createElement("form");
  form.dataset.promptbox = "";
  if (options.voiceActive) form.dataset.promptboxVoiceActive = "";
  const input = document.createElement("div");
  input.tabIndex = 0;
  const start = document.createElement("button");
  start.type = "button";
  start.setAttribute("aria-label", "Start voice input");
  const stop = document.createElement("button");
  stop.type = "button";
  stop.setAttribute("aria-label", "Stop and transcribe recording");
  const onStart = vi.fn();
  const onStop = vi.fn();
  start.addEventListener("click", onStart);
  stop.addEventListener("click", onStop);
  form.append(input, start, stop);
  document.body.append(form);
  return { form, input, start, stop, onStart, onStop };
}

describe("dictate shortcut", () => {
  it("starts the native mic of the focused composer and stops it while recording", () => {
    const first = composer();
    const second = composer();
    second.input.focus();

    expect(toggleNativeDictation(document)).toBe(true);
    expect(second.onStart).toHaveBeenCalledOnce();
    expect(first.onStart).not.toHaveBeenCalled();

    second.form.dataset.promptboxVoiceActive = "";
    toggleNativeDictation(document);
    expect(second.onStop).toHaveBeenCalledOnce();
  });

  it("falls back to the last focused composer when focus moved elsewhere", () => {
    const dispose = trackFocusedComposer(document);
    const first = composer();
    composer();
    const outside = document.createElement("button");
    document.body.append(outside);
    first.input.focus();
    outside.focus();

    const command = createDictateCommand(true);
    const context = { threadId: null, projectId: null, openPanel: () => false };
    expect(command.isAvailable?.(context)).toBe(true);
    command.run(context);
    expect(first.onStart).toHaveBeenCalledOnce();

    dispose();
    expect(command.isAvailable?.(context)).toBe(false);
  });

  it("skips hidden or disabled mic buttons", () => {
    const target = composer();
    target.start.disabled = true;
    target.input.focus();
    expect(toggleNativeDictation(document)).toBe(false);

    target.start.disabled = false;
    const hidden = document.createElement("div");
    hidden.setAttribute("inert", "");
    target.form.prepend(hidden);
    hidden.append(target.start);
    expect(toggleNativeDictation(document)).toBe(false);
    expect(target.onStart).not.toHaveBeenCalled();
  });
});
