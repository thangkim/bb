// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import type { PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { createDictateCommand } from "./app.js";
import {
  findComposerForm,
  insertTranscript,
  MIC_KEY_ATTRIBUTE,
  readCaretContext,
} from "./composer-insert.js";
import type { voiceLivePreviewRpcContract } from "./contract.js";
import { HIDE_NATIVE_MIC_CSS, NATIVE_MIC_SELECTOR } from "./native-mic.js";
import type { VoiceRecording } from "./voice-session.js";
import {
  configureVoiceSessions,
  provideVoiceClients,
  voiceSessionFor,
} from "./voice-store.js";

const app = await loadPluginApp(() => import("./app"));
const customization = app.composerCustomizations[0]!;
const micAction = customization.actions![0]!;
const previewBanner = customization.banners![0]!;

let threadCounter = 0;
function nextThreadId(): string {
  threadCounter += 1;
  return `thread-${threadCounter}`;
}

function fakeRecorder() {
  const recording: VoiceRecording = {
    startedAtMs: Date.now(),
    snapshot: () => new File(["so far"], "recording.webm"),
    stop: vi.fn(async () => new File(["everything"], "recording.webm")),
    cancel: vi.fn(),
  };
  const startRecording = vi.fn(async () => ({
    ...recording,
    startedAtMs: Date.now(),
  }));
  configureVoiceSessions({ startRecording });
  return { recording, startRecording };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("MediaRecorder", class {});
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe("registration", () => {
  it("adds its own mic button and a live-draft banner to every composer", () => {
    expect(app.composerCustomizations).toHaveLength(1);
    expect(customization.id).toBe("voice-live-preview");
    expect(customization.scopes).toBeUndefined();
    expect(customization.actions?.map((action) => action.id)).toEqual(["mic"]);
    expect(customization.banners).toMatchObject([
      { id: "live-draft", chrome: "card" },
    ]);
    expect(app.contentScripts.map((script) => script.id)).toEqual([
      "voice-input",
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

function nativeActionRow(withPluginMic: boolean) {
  const row = document.createElement("div");
  row.setAttribute("data-promptbox-action-row", "");
  const nativeMic = document.createElement("span");
  const nativeButton = document.createElement("button");
  nativeButton.setAttribute(
    "aria-label",
    "Microphone warning: open voice preferences",
  );
  nativeButton.setAttribute(
    "aria-description",
    "Right-click or press Shift+F10 for voice preferences",
  );
  nativeMic.append(nativeButton);
  const other = document.createElement("span");
  other.append(document.createElement("button"));
  row.append(nativeMic, other);
  if (withPluginMic) {
    const pluginMic = document.createElement("span");
    pluginMic.setAttribute(MIC_KEY_ATTRIBUTE, "composer");
    row.append(pluginMic);
  }
  document.body.append(row);
  return { nativeMic, other };
}

describe("native mic", () => {
  it("hides bb's mic only in composers that show the plugin's mic", async () => {
    const scripts = await mountPluginContentScripts(app, {
      pluginId: "voice-live-preview",
    });
    const style = document.head.querySelector(
      'style[data-bb-plugin="voice-live-preview"]',
    );
    expect(style?.textContent).toBe(HIDE_NATIVE_MIC_CSS);
    expect(HIDE_NATIVE_MIC_CSS).toMatch(/^:where\(/u);
    expect(HIDE_NATIVE_MIC_CSS).not.toContain("@scope");

    const expanded = nativeActionRow(true);
    const compact = nativeActionRow(false);
    const hidden = [...document.querySelectorAll(NATIVE_MIC_SELECTOR)];
    expect(hidden).toEqual([expanded.nativeMic]);
    expect(hidden).not.toContain(compact.nativeMic);
    expect(hidden).not.toContain(expanded.other);

    await scripts.lifecycle.dispose();
    expect(document.head.querySelector("style")).toBeNull();
  });
});

describe("mic button", () => {
  it("records, previews drafts in the banner, and inserts the final transcript", async () => {
    const { startRecording } = fakeRecorder();
    const transcribeVoice = vi
      .fn()
      .mockResolvedValueOnce({ text: "Words so far" })
      .mockResolvedValue({ text: "Final words" });
    const scope = { kind: "thread" as const, threadId: nextThreadId() };
    const mic = renderSlot<object, typeof voiceLivePreviewRpcContract>(
      micAction,
      {},
      {
        sdk: { system: { transcribeVoice } },
        rpc: { draftCadence: () => ({ local: false }) },
        composer: { text: "Hello", scope },
      },
    );
    const banner = renderSlot(
      previewBanner,
      {},
      {
        sdk: { system: { transcribeVoice } },
        rpc: { draftCadence: () => ({ local: false }) },
        composer: { text: "Hello", scope },
      },
    );
    expect(banner.container.textContent).toBe("");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
    });
    expect(startRecording).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toBe("Listening…");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(transcribeVoice).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Hello" }),
    );
    expect(
      banner.container.querySelector("[data-voice-live-preview-draft]")
        ?.textContent,
    ).toBe("Words so far");

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "Stop dictation and insert transcript",
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mic.inspection.composer.text).toBe("Hello Final words");
    expect(banner.container.textContent).toBe("");
    expect(
      screen.getByRole("button", { name: "Start dictation" }),
    ).toBeTruthy();
  });

  it("cancels dictation on Escape without inserting anything", async () => {
    const { recording } = fakeRecorder();
    const transcribeVoice = vi.fn(async () => ({ text: "never" }));
    const scope = { kind: "thread" as const, threadId: nextThreadId() };
    const scripts = await mountPluginContentScripts(app, {
      pluginId: "voice-live-preview",
    });
    const mic = renderSlot<object, typeof voiceLivePreviewRpcContract>(
      micAction,
      {},
      {
        sdk: { system: { transcribeVoice } },
        rpc: { draftCadence: () => ({ local: true }) },
        composer: { scope },
      },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
    });

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(escape);
    });
    expect(escape.defaultPrevented).toBe(true);
    expect(recording.cancel).toHaveBeenCalled();
    expect(mic.inspection.composer.text).toBe("");
    expect(
      screen.getByRole("button", { name: "Start dictation" }),
    ).toBeTruthy();

    const idleEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    window.dispatchEvent(idleEscape);
    expect(idleEscape.defaultPrevented).toBe(false);
    await scripts.lifecycle.dispose();
  });
});

describe("dictate command", () => {
  it("toggles the plugin's recorder in the composer that runs it", async () => {
    const { startRecording } = fakeRecorder();
    provideVoiceClients({
      transcribe: async () => "Spoken",
      draftPolicy: () => new Promise(() => {}),
    });
    const inserted: string[] = [];
    const composer = {
      key: `command-${nextThreadId()}`,
      text: "",
      insert: (parts: unknown) => {
        if (typeof parts === "string") inserted.push(parts);
      },
    } as unknown as PluginComposerApi;
    const command = createDictateCommand(true);

    await command.run({ composer });
    expect(startRecording).toHaveBeenCalledOnce();
    expect(voiceSessionFor(composer.key).getState().phase).toBe("recording");

    await vi.advanceTimersByTimeAsync(1_500);
    await command.run({ composer });
    expect(inserted).toEqual(["Spoken"]);
    expect(voiceSessionFor(composer.key).getState().phase).toBe("idle");
  });
});

function composerDom(key: string, html: string) {
  const form = document.createElement("form");
  form.setAttribute("data-promptbox", "");
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  editor.innerHTML = html;
  const mic = document.createElement("span");
  mic.setAttribute(MIC_KEY_ATTRIBUTE, key);
  form.append(editor, mic);
  document.body.append(form);
  return { form, editor };
}

function placeCaret(node: Node, offset: number) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

describe("transcript insertion", () => {
  it("reads the text around the caret within its paragraph", () => {
    const { form, editor } = composerDom(
      "a",
      "<p>First line</p><p>Hello world</p>",
    );
    placeCaret(editor.querySelectorAll("p")[1]!.firstChild!, 5);

    expect(findComposerForm(document, "a")).toBe(form);
    expect(findComposerForm(document, "b")).toBeNull();
    expect(readCaretContext(form)).toEqual({
      before: "Hello",
      after: " world",
    });
  });

  it("separates the transcript from adjacent words like bb's own dictation", () => {
    const { form, editor } = composerDom("a", "<p>Hello world</p>");
    const insert = vi.fn();
    const paragraph = editor.querySelector("p")!.firstChild!;

    placeCaret(paragraph, 5);
    insertTranscript({ text: "Hello world", insert }, form, "there");
    placeCaret(paragraph, 6);
    insertTranscript({ text: "Hello world", insert }, form, "big");
    placeCaret(paragraph, 0);
    insertTranscript({ text: "Hello world", insert }, form, "Oh");

    expect(insert.mock.calls).toEqual([[" there"], ["big "], ["Oh "]]);
  });

  it("assumes the end of the draft when the caret is elsewhere, and appends when the composer is off screen", () => {
    const { form } = composerDom("a", "<p>Hello</p>");
    document.getSelection()?.removeAllRanges();
    const insert = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("Composer is not on screen");
      })
      .mockImplementation(() => {});

    insertTranscript({ text: "Hello", insert }, form, "again");
    expect(insert.mock.calls).toEqual([[" again"], [" again", { at: "end" }]]);
  });
});
