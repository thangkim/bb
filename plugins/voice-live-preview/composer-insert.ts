import type { PluginComposerApi } from "@get-bb/plugin-sdk/app";

export const MIC_KEY_ATTRIBUTE = "data-voice-live-preview-mic";

const BLOCK_SELECTOR = "p, li, pre, blockquote, h1, h2, h3, h4, h5, h6";

export interface CaretContext {
  before: string;
  after: string;
}

export function findComposerForm(
  root: ParentNode,
  composerKey: string,
): Element | null {
  for (const marker of root.querySelectorAll(`[${MIC_KEY_ATTRIBUTE}]`)) {
    if (marker.getAttribute(MIC_KEY_ATTRIBUTE) !== composerKey) continue;
    const form = marker.closest("form[data-promptbox]");
    if (form !== null) return form;
  }
  return null;
}

function closestBlock(node: Node, editor: Element): Element {
  const element = node instanceof Element ? node : node.parentElement;
  const block = element?.closest(BLOCK_SELECTOR) ?? null;
  return block !== null && editor.contains(block) ? block : editor;
}

export function readCaretContext(form: Element | null): CaretContext | null {
  const editor = form?.querySelector('[contenteditable="true"]') ?? null;
  if (editor === null) return null;
  const selection = editor.ownerDocument.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (
    !editor.contains(range.startContainer) ||
    !editor.contains(range.endContainer)
  ) {
    return null;
  }
  const before = editor.ownerDocument.createRange();
  before.selectNodeContents(closestBlock(range.startContainer, editor));
  before.setEnd(range.startContainer, range.startOffset);
  const after = editor.ownerDocument.createRange();
  after.selectNodeContents(closestBlock(range.endContainer, editor));
  after.setStart(range.endContainer, range.endOffset);
  return { before: before.toString(), after: after.toString() };
}

export function spaceTranscript(text: string, context: CaretContext): string {
  const leading = context.before.length > 0 && !/\s$/u.test(context.before);
  const trailing = context.after.length > 0 && !/^\s/u.test(context.after);
  return `${leading ? " " : ""}${text}${trailing ? " " : ""}`;
}

export function insertTranscript(
  composer: Pick<PluginComposerApi, "insert" | "text">,
  form: Element | null,
  text: string,
): void {
  const atEnd: CaretContext = { before: composer.text, after: "" };
  try {
    composer.insert(spaceTranscript(text, readCaretContext(form) ?? atEnd));
  } catch {
    composer.insert(spaceTranscript(text, atEnd), { at: "end" });
  }
}
