// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { promptEditorExtensions } from "./prompt-editor-extensions";
import {
  beginPromptProvisionalText,
  getPromptProvisionalTextRange,
} from "./prompt-provisional-text-extension";

const editors: Editor[] = [];

function createEditor(paragraphs: string[]): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: promptEditorExtensions({
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

function placeCursor(editor: Editor, position: number): void {
  editor.commands.setTextSelection(position);
  editor.view.dom.dispatchEvent(new FocusEvent("focus"));
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

function provisionalElement(editor: Editor): HTMLElement | null {
  return editor.view.dom.querySelector("[data-promptbox-provisional-text]");
}

function renderedText(editor: Editor): string {
  return editor.view.dom.textContent ?? "";
}

function undo(editor: Editor): void {
  editor.commands.undo();
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("PromptProvisionalTextExtension", () => {
  it("paints muted, aria-hidden text at the cursor without changing the draft", () => {
    const editor = createEditor(["Hello world"]);
    placeCursor(editor, positionAfter(editor, "Hello"));

    const session = beginPromptProvisionalText(editor);
    session.update("big");

    const element = provisionalElement(editor);
    expect(element?.textContent).toBe(" big");
    expect(element?.getAttribute("aria-hidden")).toBe("true");
    expect(element?.classList.contains("text-muted-foreground")).toBe(true);
    expect(renderedText(editor)).toBe("Hello big world");
    expect(editor.getText()).toBe("Hello world");
  });

  it("adds a trailing space when the cursor touches the next word", () => {
    const editor = createEditor(["Helloworld"]);
    placeCursor(editor, positionAfter(editor, "Hello"));

    beginPromptProvisionalText(editor).update("big");

    expect(provisionalElement(editor)?.textContent).toBe(" big ");
  });

  it("continues after the last character when the cursor was never placed", () => {
    const editor = createEditor(["First line", "Second line"]);
    expect(editor.state.selection.from).toBe(1);

    beginPromptProvisionalText(editor).update("and more");

    expect(renderedText(editor)).toBe("First lineSecond line and more");
    expect(getPromptProvisionalTextRange(editor)).toEqual({
      from: editor.state.doc.content.size - 1,
      to: editor.state.doc.content.size - 1,
    });
  });

  it("keeps a deliberately placed cursor at the start", () => {
    const editor = createEditor(["world"]);
    placeCursor(editor, 1);

    beginPromptProvisionalText(editor).update("Hello");

    expect(renderedText(editor)).toBe("Hello world");
  });

  it("keeps the anchor attached to its text when content changes before it", () => {
    const editor = createEditor(["Hello world"]);
    placeCursor(editor, positionAfter(editor, "Hello"));
    beginPromptProvisionalText(editor).update("big");

    editor.commands.insertContentAt(1, "Oh ");

    expect(renderedText(editor)).toBe("Oh Hello big world");
  });

  it("never enters undo history while previewing", () => {
    const editor = createEditor(["Hello"]);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, "!");
    const session = beginPromptProvisionalText(editor);
    session.update("one");
    session.update("one two");
    session.cancel();

    undo(editor);

    expect(editor.getText()).toBe("Hello");
  });

  it("commits at the anchor with padding as one undo step", () => {
    const editor = createEditor(["Hello world"]);
    placeCursor(editor, positionAfter(editor, "Hello"));
    const session = beginPromptProvisionalText(editor);
    session.update("big");
    editor.commands.insertContentAt(1, "Oh ");

    expect(session.commit("  very   big ", { focus: false })).toBe("inserted");

    expect(editor.getText()).toBe("Oh Hello very big world");
    expect(provisionalElement(editor)).toBeNull();
    expect(getPromptProvisionalTextRange(editor)).toBeNull();
    undo(editor);
    expect(editor.getText()).toBe("Oh Hello world");
  });

  it("ignores calls after it ends and when superseded", () => {
    const editor = createEditor(["Hello"]);
    const first = beginPromptProvisionalText(editor);
    const second = beginPromptProvisionalText(editor);
    first.update("stale");
    expect(provisionalElement(editor)).toBeNull();
    expect(first.commit("stale", { focus: false })).toBe("detached");

    second.update("there");
    second.cancel();
    second.cancel();
    expect(second.commit("there", { focus: false })).toBe("ended");

    expect(provisionalElement(editor)).toBeNull();
    expect(renderedText(editor)).toBe("Hello");
  });

  it("reports a detached commit when the editor was destroyed", () => {
    const editor = createEditor(["Hello"]);
    const session = beginPromptProvisionalText(editor);
    editor.destroy();

    expect(session.commit("words", { focus: false })).toBe("detached");
  });
});
