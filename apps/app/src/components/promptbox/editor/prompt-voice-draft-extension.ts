import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  Selection,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const PROMPT_VOICE_DRAFT_CLASS = "text-muted-foreground";

export interface PromptVoiceDraftRange {
  from: number;
  to: number;
}

interface PromptVoiceDraftState {
  range: PromptVoiceDraftRange | null;
  text: string;
}

type PromptVoiceDraftMeta =
  | { type: "start"; range: PromptVoiceDraftRange }
  | { type: "text"; text: string }
  | { type: "clear" };

const EMPTY_STATE: PromptVoiceDraftState = { range: null, text: "" };

const promptVoiceDraftPluginKey = new PluginKey<PromptVoiceDraftState>(
  "promptVoiceDraft",
);

function isPromptVoiceDraftMeta(value: unknown): value is PromptVoiceDraftMeta {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  return (
    value.type === "start" || value.type === "text" || value.type === "clear"
  );
}

function applyMeta(
  state: PromptVoiceDraftState,
  meta: PromptVoiceDraftMeta,
): PromptVoiceDraftState {
  if (meta.type === "start") return { range: meta.range, text: "" };
  if (meta.type === "clear") return EMPTY_STATE;
  return state.range === null ? state : { ...state, text: meta.text };
}

function mapRange(
  range: PromptVoiceDraftRange,
  transaction: Transaction,
): PromptVoiceDraftRange {
  const from = transaction.mapping.map(range.from, -1);
  const to = Math.max(from, transaction.mapping.map(range.to, 1));
  return { from, to };
}

function isWhitespaceBoundary(text: string): boolean {
  return text.length === 0 || /\s/u.test(text);
}

export function promptVoiceDraftSpacing(
  doc: ProseMirrorNode,
  range: PromptVoiceDraftRange,
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
  state: PromptVoiceDraftState,
): DecorationSet {
  if (state.range === null || state.text.length === 0) {
    return DecorationSet.empty;
  }
  const { leading, trailing } = promptVoiceDraftSpacing(doc, state.range);
  const text = `${leading}${state.text}${trailing}`;
  const widget = Decoration.widget(
    state.range.to,
    () => {
      const element = document.createElement("span");
      element.className = PROMPT_VOICE_DRAFT_CLASS;
      element.dataset.promptboxVoiceDraft = "";
      element.setAttribute("aria-hidden", "true");
      element.textContent = text;
      return element;
    },
    { key: `voice-draft:${text}`, side: 1, ignoreSelection: true },
  );
  return DecorationSet.create(doc, [widget]);
}

export const PromptVoiceDraftExtension = Extension.create({
  name: "promptVoiceDraft",

  addProseMirrorPlugins() {
    return [
      new Plugin<PromptVoiceDraftState>({
        key: promptVoiceDraftPluginKey,
        state: {
          init: () => EMPTY_STATE,
          apply: (transaction, value) => {
            const meta: unknown = transaction.getMeta(
              promptVoiceDraftPluginKey,
            );
            const mapped =
              transaction.docChanged && value.range !== null
                ? { ...value, range: mapRange(value.range, transaction) }
                : value;
            return isPromptVoiceDraftMeta(meta)
              ? applyMeta(mapped, meta)
              : mapped;
          },
        },
        props: {
          decorations: (state) =>
            buildDecorations(
              state.doc,
              promptVoiceDraftPluginKey.getState(state) ?? EMPTY_STATE,
            ),
        },
      }),
    ];
  },
});

function dispatchVoiceDraftMeta(
  editor: Editor,
  meta: PromptVoiceDraftMeta,
): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(
    editor.state.tr
      .setMeta(promptVoiceDraftPluginKey, meta)
      .setMeta("addToHistory", false),
  );
}

export function resolvePromptVoiceDraftRange(
  editor: Editor,
  hasPlacedCursor: boolean,
): PromptVoiceDraftRange {
  const { selection, doc } = editor.state;
  const isUntouchedStart =
    !hasPlacedCursor &&
    selection.empty &&
    selection.from <= Selection.atStart(doc).from;
  if (isUntouchedStart) {
    const end = Selection.atEnd(doc).from;
    return { from: end, to: end };
  }
  return { from: selection.from, to: selection.to };
}

export function startPromptVoiceDraft(
  editor: Editor,
  range: PromptVoiceDraftRange,
): void {
  dispatchVoiceDraftMeta(editor, { type: "start", range });
}

export function setPromptVoiceDraftText(editor: Editor, text: string): void {
  if (editor.isDestroyed) return;
  const current = promptVoiceDraftPluginKey.getState(editor.state);
  if (current?.range === null || current?.text === text) return;
  dispatchVoiceDraftMeta(editor, { type: "text", text });
}

export function clearPromptVoiceDraft(editor: Editor): void {
  if (editor.isDestroyed) return;
  if (promptVoiceDraftPluginKey.getState(editor.state)?.range === null) return;
  dispatchVoiceDraftMeta(editor, { type: "clear" });
}

export function getPromptVoiceDraftRange(
  editor: Editor,
): PromptVoiceDraftRange | null {
  return promptVoiceDraftPluginKey.getState(editor.state)?.range ?? null;
}
