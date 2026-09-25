import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  Selection,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const PROMPT_PROVISIONAL_TEXT_CLASS = "text-muted-foreground";

export interface PromptProvisionalTextRange {
  from: number;
  to: number;
}

interface PromptProvisionalTextState {
  session: number | null;
  range: PromptProvisionalTextRange | null;
  text: string;
}

type PromptProvisionalTextMeta =
  | { type: "start"; session: number; range: PromptProvisionalTextRange }
  | { type: "text"; text: string }
  | { type: "clear" };

export type PromptProvisionalTextCommitResult =
  | "inserted"
  | "ended"
  | "detached";

export interface PromptProvisionalTextSession {
  update(text: string): void;
  commit(
    text: string,
    options: { focus: boolean },
  ): PromptProvisionalTextCommitResult;
  cancel(): void;
}

const EMPTY_STATE: PromptProvisionalTextState = {
  session: null,
  range: null,
  text: "",
};

const promptProvisionalTextPluginKey =
  new PluginKey<PromptProvisionalTextState>("promptProvisionalText");

const cursorPlacedEditors = new WeakSet<Editor>();
let nextSessionId = 1;

function isPromptProvisionalTextMeta(
  value: unknown,
): value is PromptProvisionalTextMeta {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  return (
    value.type === "start" || value.type === "text" || value.type === "clear"
  );
}

function applyMeta(
  state: PromptProvisionalTextState,
  meta: PromptProvisionalTextMeta,
): PromptProvisionalTextState {
  if (meta.type === "start") {
    return { session: meta.session, range: meta.range, text: "" };
  }
  if (meta.type === "clear") return EMPTY_STATE;
  return state.range === null ? state : { ...state, text: meta.text };
}

function mapRange(
  range: PromptProvisionalTextRange,
  transaction: Transaction,
): PromptProvisionalTextRange {
  const from = transaction.mapping.map(range.from, -1);
  const to = Math.max(from, transaction.mapping.map(range.to, 1));
  return { from, to };
}

function isWhitespaceBoundary(text: string): boolean {
  return text.length === 0 || /\s/u.test(text);
}

export function normalizeProvisionalText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function promptProvisionalTextSpacing(
  doc: ProseMirrorNode,
  range: PromptProvisionalTextRange,
): { leading: string; trailing: string } {
  const before = doc.textBetween(Math.max(0, range.from - 1), range.from, "\n");
  const after = doc.textBetween(
    range.to,
    Math.min(doc.content.size, range.to + 1),
    "\n",
  );
  return {
    leading: isWhitespaceBoundary(before) ? "" : " ",
    trailing: isWhitespaceBoundary(after) ? "" : " ",
  };
}

function buildDecorations(
  doc: ProseMirrorNode,
  state: PromptProvisionalTextState,
): DecorationSet {
  if (state.range === null || state.text.length === 0) {
    return DecorationSet.empty;
  }
  const { leading, trailing } = promptProvisionalTextSpacing(doc, state.range);
  const text = `${leading}${state.text}${trailing}`;
  const widget = Decoration.widget(
    state.range.to,
    () => {
      const element = document.createElement("span");
      element.className = PROMPT_PROVISIONAL_TEXT_CLASS;
      element.dataset.promptboxProvisionalText = "";
      element.setAttribute("aria-hidden", "true");
      element.textContent = text;
      return element;
    },
    { key: `provisional-text:${text}`, side: 1, ignoreSelection: true },
  );
  return DecorationSet.create(doc, [widget]);
}

export const PromptProvisionalTextExtension = Extension.create({
  name: "promptProvisionalText",

  onFocus() {
    cursorPlacedEditors.add(this.editor);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<PromptProvisionalTextState>({
        key: promptProvisionalTextPluginKey,
        state: {
          init: () => EMPTY_STATE,
          apply: (transaction, value) => {
            const meta: unknown = transaction.getMeta(
              promptProvisionalTextPluginKey,
            );
            const mapped =
              transaction.docChanged && value.range !== null
                ? { ...value, range: mapRange(value.range, transaction) }
                : value;
            return isPromptProvisionalTextMeta(meta)
              ? applyMeta(mapped, meta)
              : mapped;
          },
        },
        props: {
          decorations: (state) =>
            buildDecorations(
              state.doc,
              promptProvisionalTextPluginKey.getState(state) ?? EMPTY_STATE,
            ),
        },
      }),
    ];
  },
});

function readState(editor: Editor): PromptProvisionalTextState {
  return promptProvisionalTextPluginKey.getState(editor.state) ?? EMPTY_STATE;
}

function dispatchMeta(editor: Editor, meta: PromptProvisionalTextMeta): void {
  editor.view.dispatch(
    editor.state.tr
      .setMeta(promptProvisionalTextPluginKey, meta)
      .setMeta("addToHistory", false),
  );
}

export function resolvePromptProvisionalTextRange(
  editor: Editor,
): PromptProvisionalTextRange {
  const { selection, doc } = editor.state;
  const isUntouchedStart =
    !cursorPlacedEditors.has(editor) &&
    selection.empty &&
    selection.from <= Selection.atStart(doc).from;
  if (isUntouchedStart) {
    const end = Selection.atEnd(doc).from;
    return { from: end, to: end };
  }
  return { from: selection.from, to: selection.to };
}

export function getPromptProvisionalTextRange(
  editor: Editor,
): PromptProvisionalTextRange | null {
  return readState(editor).range;
}

export function beginPromptProvisionalText(
  editor: Editor,
): PromptProvisionalTextSession {
  const session = nextSessionId++;
  let ended = false;
  dispatchMeta(editor, {
    type: "start",
    session,
    range: resolvePromptProvisionalTextRange(editor),
  });

  const isLive = () =>
    !editor.isDestroyed && readState(editor).session === session;

  return {
    update(text) {
      if (ended || !isLive()) return;
      const normalized = normalizeProvisionalText(text);
      if (readState(editor).text === normalized) return;
      dispatchMeta(editor, { type: "text", text: normalized });
      if (normalized.length === 0) return;
      editor.view.dom
        .querySelector<HTMLElement>("[data-promptbox-provisional-text]")
        ?.scrollIntoView?.({ block: "nearest" });
    },
    commit(text, { focus }) {
      if (ended) return "ended";
      ended = true;
      if (!isLive()) return "detached";
      const normalized = normalizeProvisionalText(text);
      const range = readState(editor).range;
      if (normalized.length === 0 || range === null) {
        dispatchMeta(editor, { type: "clear" });
        return "inserted";
      }
      const { leading, trailing } = promptProvisionalTextSpacing(
        editor.state.doc,
        range,
      );
      const chain = editor.chain();
      if (focus) chain.focus();
      chain
        .command(({ tr }) => {
          tr.setMeta(promptProvisionalTextPluginKey, { type: "clear" });
          return true;
        })
        .insertContentAt(range, `${leading}${normalized}${trailing}`)
        .scrollIntoView()
        .run();
      return "inserted";
    },
    cancel() {
      if (ended) return;
      ended = true;
      if (isLive()) dispatchMeta(editor, { type: "clear" });
    },
  };
}
