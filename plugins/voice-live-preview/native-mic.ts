import { MIC_KEY_ATTRIBUTE } from "./composer-insert.js";

export const NATIVE_MIC_DESCRIPTION =
  "Right-click or press Shift+F10 for voice preferences";
export const NATIVE_MIC_LABEL = "Start voice input";

export const NATIVE_MIC_SELECTOR = `[data-promptbox-action-row]:has([${MIC_KEY_ATTRIBUTE}]) span:has(> :is(button[aria-description="${NATIVE_MIC_DESCRIPTION}"], button[aria-label="${NATIVE_MIC_LABEL}"]))`;

export const HIDE_NATIVE_MIC_CSS = `:where(${NATIVE_MIC_SELECTOR}) { display: none; }`;

export function hideNativeMic(doc: Document, pluginId: string): () => void {
  const style = doc.createElement("style");
  style.setAttribute("data-bb-plugin", pluginId);
  style.setAttribute("data-voice-live-preview-style", "");
  style.textContent = HIDE_NATIVE_MIC_CSS;
  doc.head.append(style);
  return () => style.remove();
}
