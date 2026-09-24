// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { promptEditorExtensions } from "./prompt-editor-extensions";
import {
  clearPromptVoiceDraft,
  getPromptVoiceDraftRange,
  resolvePromptVoiceDraftRange,
  setPromptVoiceDraftText,
  startPromptVoiceDraft,
} from "./prompt-voice-draft-extension";

const editors: Editor[] = [];

function createEditor(paragraphs: string[]): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: promptEditorExtensions({
      richTextEditing: false,
      getPlaceholder: () => "",
    }),
    content: {
      type: "doc",
      content: paragraphs.map((text) => ({
        type: "paragraph",
        content: text.length > 0 ? [{ type: "text", text }] : [],
      })),
    },
  });
  editors.push(editor);
  return editor;
}

function positionAfter(editor: Editor, needle: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1 || !node.isText || !node.text) return;
    const index = node.text.indexOf(needle);
    if (index !== -1) found = pos + index + needle.length;
  });
  if (found === -1) throw new Error(`Missing ${needle}`);
  return found;
}

function draftElement(editor: Editor): HTMLElement | null {
  return editor.view.dom.querySelector("[data-promptbox-voice-draft]");
}

function renderedText(editor: Editor): string {
  return editor.view.dom.textContent ?? "";
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("PromptVoiceDraftExtension", () => {
  it("shows the live draft inside the text at the cursor", () => {
    const editor = createEditor(["Hello world"]);
    const cursor = positionAfter(editor, "Hello");
    editor.commands.setTextSelection(cursor);

    startPromptVoiceDraft(editor, resolvePromptVoiceDraftRange(editor, true));
    setPromptVoiceDraftText(editor, "big");

    expect(draftElement(editor)?.textContent).toBe(" big");
    expect(renderedText(editor)).toBe("Hello big world");
    expect(editor.getText()).toBe("Hello world");
  });

  it("adds a trailing space when the cursor touches the next word", () => {
    const editor = createEditor(["Helloworld"]);
    editor.commands.setTextSelection(positionAfter(editor, "Hello"));

    startPromptVoiceDraft(editor, resolvePromptVoiceDraftRange(editor, true));
    setPromptVoiceDraftText(editor, "big");

    expect(draftElement(editor)?.textContent).toBe(" big ");
  });

  it("continues after the last character when no cursor was placed", () => {
    const editor = createEditor(["First line", "Second line"]);
    expect(editor.state.selection.from).toBe(1);

    startPromptVoiceDraft(editor, resolvePromptVoiceDraftRange(editor, false));
    setPromptVoiceDraftText(editor, "and more");

    expect(renderedText(editor)).toBe("First lineSecond line and more");
    expect(getPromptVoiceDraftRange(editor)).toEqual({
      from: editor.state.doc.content.size - 1,
      to: editor.state.doc.content.size - 1,
    });
  });

  it("keeps a deliberately placed cursor at the start", () => {
    const editor = createEditor(["world"]);
    editor.commands.setTextSelection(1);

    startPromptVoiceDraft(editor, resolvePromptVoiceDraftRange(editor, true));
    setPromptVoiceDraftText(editor, "Hello");

    expect(renderedText(editor)).toBe("Hello world");
  });

  it("keeps the anchor attached to its text when content changes before it", () => {
    const editor = createEditor(["Hello world"]);
    editor.commands.setTextSelection(positionAfter(editor, "Hello"));
    startPromptVoiceDraft(editor, resolvePromptVoiceDraftRange(editor, true));
    setPromptVoiceDraftText(editor, "big");

    editor.commands.insertContentAt(1, "Oh ");

    expect(renderedText(editor)).toBe("Oh Hello big world");
  });

  it("removes the draft when cleared", () => {
    const editor = createEditor(["Hello"]);
    startPromptVoiceDraft(editor, resolvePromptVoiceDraftRange(editor, false));
    setPromptVoiceDraftText(editor, "there");

    clearPromptVoiceDraft(editor);

    expect(draftElement(editor)).toBeNull();
    expect(getPromptVoiceDraftRange(editor)).toBeNull();
    expect(renderedText(editor)).toBe("Hello");
  });
});
