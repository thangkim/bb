// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeVoiceInput } from "@/lib/api";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import type { PromptBoxHandle } from "./PromptBoxInternal";
import type { PromptVoiceSession } from "./plugin-voice-input";
import { usePromptVoice } from "./usePromptVoice";
import type { PromptDraftState } from "@bb/client-core";

vi.mock("@/lib/api", () => ({
  transcribeVoiceInput: vi.fn(),
}));

vi.mock("@/hooks/useVoiceInput", () => ({
  useVoiceInput: vi.fn(),
}));

type VoiceState = "idle" | "recording" | "transcribing" | "error";

const recordingFile = new File(["so far"], "recording.webm", {
  type: "audio/webm",
});

const voiceInput = {
  state: "transcribing" as const,
  microphoneWarning: null,
  isSupported: true,
  unsupportedReason: null,
  stream: null,
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  readRecording: () => recordingFile,
};

function mockVoiceInput(state: VoiceState) {
  vi.mocked(useVoiceInput).mockReturnValue({
    state,
    microphoneWarning: null,
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
    sendVoiceTranscript: vi.fn(),
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

  it("sends a plugin transcript through the plugin session", () => {
    mockVoiceInput("recording");
    const session: PromptVoiceSession = {
      finish: vi.fn(async () => "Plugin words"),
      insert: vi.fn(),
      end: vi.fn(),
    };
    const promptBoxRef = promptBoxHandle(() => session);
    promptBoxRef.current.sendVoiceTranscript.mockImplementation(
      (text: string, insert?: (text: string) => void) => insert?.(text),
    );
    const { result } = renderHook(() => usePromptVoice(promptBoxRef));

    act(() => result.current.send());
    act(() => latestVoiceOptions().onTranscript("Plugin words"));

    expect(promptBoxRef.current.sendVoiceTranscript).toHaveBeenCalledOnce();
    expect(session.insert).toHaveBeenCalledExactlyOnceWith("Plugin words");
    expect(promptBoxRef.current.insertTextAtCursor).not.toHaveBeenCalled();
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

  it("sends only a successful send transcript, never a cancelled or add-to-draft transcript", () => {
    vi.mocked(useVoiceInput).mockReturnValue({
      ...voiceInput,
      state: "recording",
      isRecording: true,
      isProcessing: false,
      isListening: true,
    });
    const insertTextAtCursor = vi.fn();
    const sendVoiceTranscript = vi.fn();
    const promptBoxRef = {
      current: {
        captureHeightForLayoutChange: vi.fn(),
        focusEnd: vi.fn(),
        getTextBeforeCursor: vi.fn(),
        insertTextAtCursor,
        sendVoiceTranscript,
        playVoiceCompletionTransition: vi.fn(),
        beginPluginVoiceInput: vi.fn(() => null),
      } satisfies PromptBoxHandle,
    };
    const { result } = renderHook(() => usePromptVoice(promptBoxRef));
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
    act(() => {
      result.current.send();
      result.current.send();
    });
    expect(voiceInput.stop).toHaveBeenCalledOnce();
    act(() => options?.onTranscript("first transcript"));
    expect(sendVoiceTranscript).toHaveBeenCalledExactlyOnceWith(
      "first transcript",
    );
    act(() => {
      result.current.send();
      result.current.cancel();
      options?.onTranscript("cancelled transcript");
    });
    expect(sendVoiceTranscript).toHaveBeenCalledOnce();
    expect(insertTextAtCursor).toHaveBeenCalledWith("cancelled transcript");
    act(() => {
      result.current.stop();
      options?.onTranscript("draft transcript");
    });
    expect(insertTextAtCursor).toHaveBeenCalledWith("draft transcript");
    expect(sendVoiceTranscript).toHaveBeenCalledOnce();
  });

  it("does not carry send intent into another recording after transcription fails", () => {
    let state: "recording" | "error" = "recording";
    vi.mocked(useVoiceInput).mockImplementation(() => ({
      ...voiceInput,
      state,
      isRecording: state === "recording",
      isProcessing: false,
      isListening: state === "recording",
    }));
    const insertTextAtCursor = vi.fn();
    const sendVoiceTranscript = vi.fn();
    const promptBoxRef = {
      current: {
        captureHeightForLayoutChange: vi.fn(),
        focusEnd: vi.fn(),
        getTextBeforeCursor: vi.fn(),
        insertTextAtCursor,
        sendVoiceTranscript,
        playVoiceCompletionTransition: vi.fn(),
        beginPluginVoiceInput: vi.fn(() => null),
      } satisfies PromptBoxHandle,
    };
    const { result, rerender } = renderHook(() => usePromptVoice(promptBoxRef));
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
    act(() => result.current.send());
    state = "error";
    rerender();
    state = "recording";
    rerender();
    act(() => options?.onTranscript("later transcript"));
    expect(sendVoiceTranscript).not.toHaveBeenCalled();
    expect(insertTextAtCursor).toHaveBeenCalledExactlyOnceWith(
      "later transcript",
    );
  });

  it.each(["send", "stop"] as const)(
    "preserves %s intent for the originating draft after navigating away",
    async (action) => {
      vi.mocked(useVoiceInput).mockReturnValue({
        ...voiceInput,
        state: "recording",
        isRecording: true,
        isProcessing: false,
        isListening: true,
      });
      const sendVoiceTranscript = vi.fn();
      const promptBoxRef = {
        current: {
          captureHeightForLayoutChange: vi.fn(),
          focusEnd: vi.fn(),
          getTextBeforeCursor: vi.fn(),
          insertTextAtCursor: vi.fn(),
          sendVoiceTranscript,
          playVoiceCompletionTransition: vi.fn(),
          beginPluginVoiceInput: vi.fn(() => null),
        } satisfies PromptBoxHandle,
      };
      let draft: PromptDraftState = {
        text: "Existing",
        mentions: [],
        attachments: [],
      };
      const submit = vi.fn(async () => {
        expect(draft.text).toBe("Existing and later edits late transcript");
      });
      const origin = {
        getCurrent: () => draft,
        setDraft: (next: PromptDraftState) => {
          draft = next;
        },
        submit,
      };
      const { result, unmount } = renderHook(() =>
        usePromptVoice(promptBoxRef, origin),
      );
      const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
      act(() => result.current[action]());
      unmount();
      draft = { ...draft, text: "Existing and later edits" };
      await options?.onTranscript("late transcript");
      expect(draft.text).toBe("Existing and later edits late transcript");
      expect(sendVoiceTranscript).not.toHaveBeenCalled();
      expect(promptBoxRef.current.insertTextAtCursor).not.toHaveBeenCalled();
      expect(submit).toHaveBeenCalledTimes(action === "send" ? 1 : 0);
    },
  );

  it("appends a completed transcript to the originating draft after unmount", () => {
    vi.mocked(useVoiceInput).mockReturnValue({
      ...voiceInput,
      isRecording: false,
      isProcessing: true,
      isListening: false,
    });
    const promptBoxRef = { current: null };
    let draft: PromptDraftState = {
      text: "Existing",
      mentions: [],
      attachments: [],
    };
    const getCurrent = vi.fn(() => draft);
    const setDraft = vi.fn((next: PromptDraftState) => {
      draft = next;
    });
    renderHook(() => usePromptVoice(promptBoxRef, { getCurrent, setDraft }));
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
    draft = { ...draft, text: "Existing and later edits" };
    options?.onTranscript("new words");
    expect(draft).toEqual({
      text: "Existing and later edits new words",
      mentions: [],
      attachments: [],
    });
  });
});
