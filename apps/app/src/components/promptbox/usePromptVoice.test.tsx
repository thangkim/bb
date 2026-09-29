// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeVoiceInput } from "@/lib/api";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import type { PromptBoxHandle } from "./PromptBoxInternal";
import type { PromptVoiceSession } from "./plugin-voice-input";
import { usePromptVoice } from "./usePromptVoice";

vi.mock("@/lib/api", () => ({
  transcribeVoiceInput: vi.fn(),
}));

vi.mock("@/hooks/useVoiceInput", () => ({
  useVoiceInput: vi.fn(),
}));

const systemConfig = vi.hoisted(() => ({
  data: { voiceTranscriptionRunsLocally: false } as
    | { voiceTranscriptionRunsLocally: boolean }
    | undefined,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => systemConfig,
}));

type VoiceState = "idle" | "recording" | "transcribing" | "error";

const recordingFile = new File(["so far"], "recording.webm", {
  type: "audio/webm",
});

function mockVoiceInput(state: VoiceState) {
  vi.mocked(useVoiceInput).mockReturnValue({
    state,
    isSupported: true,
    unsupportedReason: null,
    stream: null,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    readRecording: () => recordingFile,
    isRecording: state === "recording",
    isProcessing: state === "transcribing",
    isListening: state === "recording" || state === "transcribing",
  });
}

function promptBoxHandle(
  beginPluginVoiceInput: PromptBoxHandle["beginPluginVoiceInput"] = () => null,
) {
  const handle = {
    captureHeightForLayoutChange: vi.fn(),
    focusEnd: vi.fn(),
    getTextBeforeCursor: vi.fn(() => "Before caret"),
    insertTextAtCursor: vi.fn(),
    playVoiceCompletionTransition: vi.fn(async () => {}),
    beginPluginVoiceInput: vi.fn(beginPluginVoiceInput),
  } satisfies PromptBoxHandle;
  return { current: handle };
}

function latestVoiceOptions() {
  const options = vi.mocked(useVoiceInput).mock.calls.at(-1)?.[0];
  if (!options) throw new Error("useVoiceInput was not called");
  return options;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  systemConfig.data = { voiceTranscriptionRunsLocally: false };
});

describe("usePromptVoice", () => {
  it("waits for the completion transition after transcription resolves", async () => {
    mockVoiceInput("transcribing");
    vi.mocked(transcribeVoiceInput).mockResolvedValue({ text: "Transcript" });

    let finishTransition: (() => void) | undefined;
    const promptBoxRef = promptBoxHandle();
    promptBoxRef.current.playVoiceCompletionTransition.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishTransition = resolve;
        }),
    );

    renderHook(() => usePromptVoice(promptBoxRef));
    const transcription = latestVoiceOptions().onTranscribe({
      file: new File([], "recording.webm", { type: "audio/webm" }),
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(
      promptBoxRef.current.playVoiceCompletionTransition,
    ).toHaveBeenCalledOnce();

    let settled = false;
    void transcription.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    finishTransition?.();
    await expect(transcription).resolves.toBe("Transcript");
    expect(promptBoxRef.current.insertTextAtCursor).not.toHaveBeenCalled();
  });

  it("keeps the native flow when no plugin takes the recording", async () => {
    mockVoiceInput("idle");
    vi.mocked(transcribeVoiceInput).mockResolvedValue({ text: "Native" });
    const promptBoxRef = promptBoxHandle();
    const { rerender } = renderHook(() => usePromptVoice(promptBoxRef));

    mockVoiceInput("recording");
    rerender();
    expect(promptBoxRef.current.beginPluginVoiceInput).toHaveBeenCalledOnce();

    mockVoiceInput("transcribing");
    rerender();
    const options = latestVoiceOptions();
    await expect(
      options.onTranscribe({ file: recordingFile, promptContext: "hint" }),
    ).resolves.toBe("Native");
    expect(transcribeVoiceInput).toHaveBeenCalledWith(
      recordingFile,
      "hint",
      undefined,
    );
    options.onTranscript("Native");
    expect(promptBoxRef.current.insertTextAtCursor).toHaveBeenCalledWith(
      "Native",
    );
  });

  it("hands the recording to a plugin session and inserts through it", async () => {
    mockVoiceInput("idle");
    const session: PromptVoiceSession = {
      finish: vi.fn(async () => "Plugin words"),
      insert: vi.fn(),
      end: vi.fn(),
    };
    let input:
      | Parameters<PromptBoxHandle["beginPluginVoiceInput"]>[0]
      | undefined;
    const promptBoxRef = promptBoxHandle((next) => {
      input = next;
      return session;
    });
    const { rerender } = renderHook(() => usePromptVoice(promptBoxRef));

    mockVoiceInput("recording");
    rerender();
    expect(input?.readRecording()).toBe(recordingFile);
    expect(input?.serviceRunsLocally).toBe(false);
    vi.mocked(transcribeVoiceInput).mockResolvedValue({ text: "Draft" });
    const signal = new AbortController().signal;
    await expect(input?.transcribe(recordingFile, signal)).resolves.toBe(
      "Draft",
    );
    expect(transcribeVoiceInput).toHaveBeenLastCalledWith(
      recordingFile,
      "Before caret",
      signal,
    );
    vi.mocked(transcribeVoiceInput).mockClear();

    mockVoiceInput("transcribing");
    rerender();
    const options = latestVoiceOptions();
    await expect(options.onTranscribe({ file: recordingFile })).resolves.toBe(
      "Plugin words",
    );
    expect(session.finish).toHaveBeenCalledWith(recordingFile);
    expect(transcribeVoiceInput).not.toHaveBeenCalled();
    expect(
      promptBoxRef.current.playVoiceCompletionTransition,
    ).toHaveBeenCalledOnce();

    options.onTranscript("Plugin words");
    expect(session.insert).toHaveBeenCalledWith("Plugin words");
    expect(promptBoxRef.current.insertTextAtCursor).not.toHaveBeenCalled();

    mockVoiceInput("idle");
    rerender();
    expect(session.end).toHaveBeenCalledOnce();
  });

  it("ends the plugin session when recording is cancelled or the composer unmounts", () => {
    mockVoiceInput("idle");
    const sessions: PromptVoiceSession[] = [];
    const promptBoxRef = promptBoxHandle(() => {
      const session = {
        finish: vi.fn(async () => ""),
        insert: vi.fn(),
        end: vi.fn(),
      };
      sessions.push(session);
      return session;
    });
    const { rerender, unmount } = renderHook(() =>
      usePromptVoice(promptBoxRef),
    );

    mockVoiceInput("recording");
    rerender();
    mockVoiceInput("idle");
    rerender();
    expect(sessions[0]?.end).toHaveBeenCalledOnce();

    mockVoiceInput("recording");
    rerender();
    expect(sessions).toHaveLength(2);
    unmount();
    expect(sessions[1]?.end).toHaveBeenCalledOnce();
    expect(sessions[0]?.finish).not.toHaveBeenCalled();
  });

  it("tells the plugin session whether the voice service runs locally", () => {
    systemConfig.data = { voiceTranscriptionRunsLocally: true };
    mockVoiceInput("idle");
    let input:
      | Parameters<PromptBoxHandle["beginPluginVoiceInput"]>[0]
      | undefined;
    const promptBoxRef = promptBoxHandle((next) => {
      input = next;
      return null;
    });
    const { rerender } = renderHook(() => usePromptVoice(promptBoxRef));

    mockVoiceInput("recording");
    rerender();

    expect(input?.serviceRunsLocally).toBe(true);
  });

  it("treats a config that has not loaded yet as a remote service", () => {
    systemConfig.data = undefined;
    mockVoiceInput("idle");
    let input:
      | Parameters<PromptBoxHandle["beginPluginVoiceInput"]>[0]
      | undefined;
    const promptBoxRef = promptBoxHandle((next) => {
      input = next;
      return null;
    });
    const { rerender } = renderHook(() => usePromptVoice(promptBoxRef));

    mockVoiceInput("recording");
    rerender();

    expect(input?.serviceRunsLocally).toBe(false);
  });
});
