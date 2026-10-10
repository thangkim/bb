// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExperimentalComposerVoiceInput,
  ExperimentalComposerVoiceSession,
} from "@get-bb/plugin-sdk";
import type { ResolvedComposerVoiceInput } from "@/lib/plugin-slot-resolvers";
import { promptEditorExtensions } from "./editor/prompt-editor-extensions";
import { startPluginVoiceSession } from "./plugin-voice-input";

const editors: Editor[] = [];
const recording = new File(["audio"], "recording.webm", { type: "audio/webm" });

function createEditor(text: string): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: promptEditorExtensions({
      getPlaceholder: () => "",
    }),
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
  });
  editors.push(editor);
  return editor;
}

function resolved(
  voiceInput: ExperimentalComposerVoiceInput,
): ResolvedComposerVoiceInput {
  return {
    key: "voice/1/live/voice-input",
    pluginId: "voice",
    customizationId: "live",
    generation: 1,
    voiceInput,
  };
}

function start(
  editor: Editor | null,
  voiceInput: ExperimentalComposerVoiceInput | null,
) {
  const insertAtCaret = vi.fn();
  const transcribe = vi.fn(async () => "draft words");
  const session = startPluginVoiceSession({
    voiceInput: voiceInput === null ? null : resolved(voiceInput),
    editor,
    input: { readRecording: () => recording, transcribe },
    insertAtCaret,
  });
  return { session, insertAtCaret, transcribe };
}

function provisionalElement(editor: Editor): Element | null {
  return editor.view.dom.querySelector("[data-promptbox-provisional-text]");
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

describe("startPluginVoiceSession", () => {
  it("returns null without a plugin so bb transcribes natively", () => {
    const editor = createEditor("Hello");
    expect(start(editor, null).session).toBeNull();
    expect(provisionalElement(editor)).toBeNull();
  });

  it("gives the plugin the recording, bb transcription, a caret preview, and a signal", async () => {
    const editor = createEditor("Hello");
    let received: ExperimentalComposerVoiceSession | undefined;
    const finish = vi.fn(async () => "final words");
    const { session, transcribe, insertAtCaret } = start(editor, {
      start(next) {
        received = next;
        return { finish };
      },
    });

    expect(received?.readRecording()).toBe(recording);
    const signal = new AbortController().signal;
    await expect(received?.transcribe(recording, { signal })).resolves.toBe(
      "draft words",
    );
    expect(transcribe).toHaveBeenCalledWith(recording, signal);
    received?.provisionalText?.update("so far");
    expect(editor.view.dom.textContent).toBe("Hello so far");
    expect(editor.getText()).toBe("Hello");

    await expect(session?.finish(recording)).resolves.toBe("final words");
    expect(finish).toHaveBeenCalledWith(recording);
    editor.commands.insertContentAt(1, "Oh ");
    session?.insert("final words");

    expect(editor.getText()).toBe("Oh Hello final words");
    expect(provisionalElement(editor)).toBeNull();
    expect(insertAtCaret).not.toHaveBeenCalled();
    expect(received?.signal.aborted).toBe(true);
  });

  it("inserts at the caret when the preview already ended or no editor exists", () => {
    const editor = createEditor("Hello");
    let received: ExperimentalComposerVoiceSession | undefined;
    const withEditor = start(editor, {
      start(next) {
        received = next;
        return { finish: async () => "" };
      },
    });
    received?.provisionalText?.cancel();
    withEditor.session?.insert("words");
    expect(withEditor.insertAtCaret).toHaveBeenCalledWith("words");
    expect(editor.getText()).toBe("Hello");

    const withoutEditor = start(null, {
      start(next) {
        received = next;
        return { finish: async () => "" };
      },
    });
    expect(received?.provisionalText).toBeNull();
    withoutEditor.session?.insert("more");
    expect(withoutEditor.insertAtCaret).toHaveBeenCalledWith("more");
  });

  it("cancels the preview, aborts the signal, and rejects a pending finish when the session ends", async () => {
    const editor = createEditor("Hello");
    let received: ExperimentalComposerVoiceSession | undefined;
    const { session } = start(editor, {
      start(next) {
        received = next;
        return { finish: () => new Promise<string>(() => {}) };
      },
    });
    received?.provisionalText?.update("listening");
    const pending = session?.finish(recording);

    session?.end();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(received?.signal.aborted).toBe(true);
    expect(provisionalElement(editor)).toBeNull();
    expect(editor.getText()).toBe("Hello");
  });

  it("propagates a finish rejection so bb shows its error", async () => {
    const error = new Error("HTTP 403: blocked");
    const { session } = start(createEditor("Hello"), {
      start: () => ({
        finish: async () => {
          throw error;
        },
      }),
    });
    await expect(session?.finish(recording)).rejects.toBe(error);
  });

  it("falls back to native transcription when start throws or returns no finish", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const editor = createEditor("Hello");
    expect(
      start(editor, {
        start() {
          throw new Error("broken");
        },
      }).session,
    ).toBeNull();
    expect(
      start(editor, {
        start: () => ({}) as never,
      }).session,
    ).toBeNull();
    expect(provisionalElement(editor)).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });
});
