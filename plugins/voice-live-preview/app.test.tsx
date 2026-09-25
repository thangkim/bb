// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  PluginBrowserBbSdk,
  PluginComposerApi,
} from "@get-bb/plugin-sdk/app";
import { beginVoicePreview, createDictateCommand } from "./app.js";
import { registerDictateTarget } from "./dictate-registry.js";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));

type SystemConfig = Awaited<ReturnType<PluginBrowserBbSdk["system"]["config"]>>;
type TranscribeArgs = Parameters<
  PluginBrowserBbSdk["system"]["transcribeVoice"]
>[0];

const app = await loadPluginApp(() => import("./app"));
const customization = app.composerCustomizations[0]!;
const dictateAction = customization.actions![0]!;
const previewBanner = customization.banners![0]!;

class ChunkingRecorder {
  static isTypeSupported = () => true;
  mimeType = "audio/webm";
  state = "inactive";
  timer: ReturnType<typeof setInterval> | null = null;
  onstart = () => {};
  ondataavailable = (_event: { data: Blob }) => {};
  onerror = () => {};
  onstop = () => {};
  start(timesliceMs: number) {
    this.state = "recording";
    this.timer = setInterval(() => {
      this.ondataavailable({ data: new Blob(["chunk"]) });
    }, timesliceMs);
    this.onstart();
  }
  stop() {
    this.state = "inactive";
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.ondataavailable({ data: new Blob(["chunk"]) });
    this.onstop();
  }
}

const trackStop = vi.fn();
const getUserMedia = vi.fn(async () => ({
  getTracks: () => [{ stop: trackStop }],
}));

function systemConfig(voiceTranscriptionEnabled: boolean): SystemConfig {
  return { voiceTranscriptionEnabled } as SystemConfig;
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderDictate(
  transcribeVoice: (args: TranscribeArgs) => Promise<{ text: string }>,
  enabled = true,
) {
  return renderSlot(
    dictateAction,
    {},
    {
      composer: {
        text: "Hello",
        scope: { kind: "thread", threadId: "thr_voice" },
      },
      sdk: {
        system: {
          config: async () => systemConfig(enabled),
          transcribeVoice,
        },
      },
    },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("MediaRecorder", ChunkingRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("registration", () => {
  it("adds the dictate action to thread, new-thread, and side-chat composers", () => {
    expect(customization).toMatchObject({
      id: "voice-live-preview",
      scopes: ["thread", "new-thread", "side-chat"],
      actions: [{ id: "dictate" }],
      banners: [{ id: "preview", chrome: "bare" }],
    });
  });

  it("binds Control+V by default only on macOS", () => {
    expect(createDictateCommand(true)).toMatchObject({
      id: "dictate",
      title: "Voice: dictate into the composer",
      defaultShortcut: { key: "v", control: true },
    });
    expect(createDictateCommand(false).defaultShortcut).toBeUndefined();
  });

  it("toggles the focused composer's dictation from the command", () => {
    const first = document.createElement("form");
    const second = document.createElement("form");
    const input = document.createElement("input");
    second.append(input);
    document.body.append(first, second);
    const firstToggle = vi.fn();
    const secondToggle = vi.fn();
    const one = registerDictateTarget({
      root: () => first,
      toggle: firstToggle,
    });
    const two = registerDictateTarget({
      root: () => second,
      toggle: secondToggle,
    });
    const command = createDictateCommand(true);
    const context = { threadId: null, projectId: null, openPanel: () => false };

    input.focus();
    command.run(context);
    expect(secondToggle).toHaveBeenCalledOnce();

    input.blur();
    one.markFocused();
    command.run(context);
    expect(firstToggle).toHaveBeenCalledOnce();
    expect(command.isAvailable?.(context)).toBe(true);

    one.unregister();
    two.unregister();
    first.remove();
    second.remove();
    expect(command.isAvailable?.(context)).toBe(false);
  });
});

describe("dictate action", () => {
  it("is hidden when voice transcription is not configured", async () => {
    renderDictate(async () => ({ text: "" }), false);
    await flush();

    expect(
      screen.queryByRole("button", { name: "Start dictation" }),
    ).toBeNull();
    expect(document.querySelector("[data-voice-live-preview]")).toBeNull();
  });

  it("previews drafts at the caret and commits the final transcript", async () => {
    const replies = ["Words so far", "Final words"];
    const transcribeVoice = vi.fn(async (_args: TranscribeArgs) => ({
      text: replies.shift() ?? "",
    }));
    const slot = renderDictate(transcribeVoice);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
    await flush();
    expect(slot.composer.provisionalTextCalls).toEqual([{ type: "begin" }]);
    expect(
      screen.getByRole("button", { name: "Stop and transcribe recording" }),
    ).toBeTruthy();

    await flush(3_000);
    expect(transcribeVoice).toHaveBeenCalledTimes(1);
    expect(transcribeVoice.mock.calls[0]?.[0].prompt).toBe("Hello");
    expect(slot.composer.provisionalText).toBe("Words so far");

    fireEvent.click(
      screen.getByRole("button", { name: "Stop and transcribe recording" }),
    );
    await flush();

    expect(transcribeVoice).toHaveBeenCalledTimes(2);
    expect(slot.composer.text).toBe("Hello Final words");
    expect(slot.composer.provisionalTextCalls.at(-1)).toEqual({
      type: "commit",
      text: "Final words",
    });
    expect(trackStop).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Start dictation" }),
    ).toBeTruthy();
  });

  it("waits for an in-flight draft before sending the final request", async () => {
    let finishDraft: ((value: { text: string }) => void) | undefined;
    let draftSignal: AbortSignal | undefined;
    const transcribeVoice = vi
      .fn<(args: TranscribeArgs) => Promise<{ text: string }>>()
      .mockImplementationOnce(
        ({ signal }) =>
          new Promise((resolve) => {
            draftSignal = signal;
            finishDraft = resolve;
          }),
      )
      .mockResolvedValue({ text: "Final" });
    const slot = renderDictate(transcribeVoice);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
    await flush(3_000);

    fireEvent.click(
      screen.getByRole("button", { name: "Stop and transcribe recording" }),
    );
    await flush();
    expect(
      screen.getByRole("button", { name: "Transcribing voice input" }),
    ).toBeTruthy();
    expect(draftSignal?.aborted).toBe(false);
    expect(transcribeVoice).toHaveBeenCalledTimes(1);

    await act(async () => finishDraft?.({ text: "Draft" }));
    await flush();
    expect(transcribeVoice).toHaveBeenCalledTimes(2);
    expect(slot.composer.text).toBe("Hello Final");
  });

  it("inserts the last draft with a warning when the final request fails twice", async () => {
    const transcribeVoice = vi
      .fn<(args: TranscribeArgs) => Promise<{ text: string }>>()
      .mockResolvedValueOnce({ text: "Words heard so far" })
      .mockRejectedValue(new Error("HTTP 403: Cloudflare challenge"));
    const slot = renderDictate(transcribeVoice);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
    await flush(3_000);

    fireEvent.click(
      screen.getByRole("button", { name: "Stop and transcribe recording" }),
    );
    await flush(700);

    expect(transcribeVoice).toHaveBeenCalledTimes(3);
    expect(slot.composer.text).toBe("Hello Words heard so far");
    expect(toast.error).not.toHaveBeenCalled();
    const [title, options] = vi.mocked(toast.warning).mock.calls[0] ?? [];
    expect(title).toBe("Voice input used the live preview");
    expect(options).toMatchObject({
      description: "Cloudflare challenge",
      action: { label: "Download recording" },
    });
  });

  it("shows an error with a download when the final fails and no draft exists", async () => {
    const transcribeVoice = vi.fn(async (): Promise<{ text: string }> => {
      throw new Error("offline");
    });
    const slot = renderDictate(transcribeVoice);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
    await flush(1_500);

    fireEvent.click(
      screen.getByRole("button", { name: "Stop and transcribe recording" }),
    );
    await flush(700);

    expect(transcribeVoice).toHaveBeenCalledTimes(2);
    expect(slot.composer.text).toBe("Hello");
    expect(slot.composer.provisionalText).toBeNull();
    expect(slot.composer.provisionalTextCalls.at(-1)).toEqual({
      type: "cancel",
    });
    const [title, options] = vi.mocked(toast.error).mock.calls[0] ?? [];
    expect(title).toBe("Voice input failed");
    expect(options).toMatchObject({
      description: "offline",
      action: { label: "Download recording" },
    });
  });

  it("aborts an in-flight draft and clears the preview when cancelled", async () => {
    let draftSignal: AbortSignal | undefined;
    const transcribeVoice = vi.fn(
      ({ signal }: TranscribeArgs) =>
        new Promise<{ text: string }>(() => {
          draftSignal = signal;
        }),
    );
    const slot = renderDictate(transcribeVoice);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
    await flush(3_000);

    fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));
    await flush(10_000);

    expect(draftSignal?.aborted).toBe(true);
    expect(transcribeVoice).toHaveBeenCalledOnce();
    expect(slot.composer.provisionalText).toBeNull();
    expect(slot.composer.text).toBe("Hello");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("stops recording and cancels the preview when the slot unmounts", async () => {
    const slot = renderDictate(async () => ({ text: "" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
    await flush(500);

    slot.unmount();
    await flush(10_000);

    expect(trackStop).toHaveBeenCalled();
    expect(slot.composer.provisionalText).toBeNull();
    expect(slot.composer.text).toBe("Hello");
  });

  it("uses the preferred microphone from Voice input settings", async () => {
    localStorage.setItem("bb.voiceInput.audioInputDeviceId", "mic-2");
    renderDictate(async () => ({ text: "" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
    await flush();

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { deviceId: { exact: "mic-2" } },
    });
  });
});

describe("fallback preview", () => {
  it("shows a banner and appends the text when the host has no provisional text", async () => {
    let text = "Hello";
    const composer: Pick<PluginComposerApi, "updateText"> = {
      updateText: (updater) => {
        text = updater(text);
      },
    };
    renderSlot(
      previewBanner,
      {},
      {
        composer: { scope: { kind: "thread", threadId: "thr_old_host" } },
      },
    );
    const preview = beginVoicePreview(composer, "thread:thr_old_host");
    await flush();
    expect(screen.getByText("Listening…")).toBeTruthy();

    act(() => preview.update("so far"));
    expect(screen.getByText("so far")).toBeTruthy();

    act(() => preview.commit("final words"));
    expect(text).toBe("Hello final words");
    expect(
      document.querySelector("[data-voice-live-preview-banner]"),
    ).toBeNull();
  });
});
