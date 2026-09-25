export const COMPOSER_SELECTOR = "form[data-promptbox]";
const START_SELECTOR = 'button[aria-label="Start voice input"]';
const STOP_SELECTOR = 'button[aria-label="Stop and transcribe recording"]';

let lastFocusedComposer: Element | null = null;

export function trackFocusedComposer(doc: Document): () => void {
  const onFocusIn = (event: FocusEvent) => {
    if (!(event.target instanceof Element)) return;
    const composer = event.target.closest(COMPOSER_SELECTOR);
    if (composer !== null) lastFocusedComposer = composer;
  };
  doc.addEventListener("focusin", onFocusIn, true);
  return () => {
    doc.removeEventListener("focusin", onFocusIn, true);
    lastFocusedComposer = null;
  };
}

export function resolveDictateComposer(doc: Document): Element | null {
  const focused = doc.activeElement?.closest(COMPOSER_SELECTOR) ?? null;
  if (focused !== null) return focused;
  if (lastFocusedComposer?.isConnected) return lastFocusedComposer;
  const composers = doc.querySelectorAll(COMPOSER_SELECTOR);
  return composers.length === 1 ? (composers[0] ?? null) : null;
}

export function findDictateButton(composer: Element): HTMLButtonElement | null {
  const selector = composer.hasAttribute("data-promptbox-voice-active")
    ? STOP_SELECTOR
    : START_SELECTOR;
  for (const button of composer.querySelectorAll<HTMLButtonElement>(selector)) {
    if (!button.disabled && button.closest("[inert]") === null) return button;
  }
  return null;
}

export function toggleNativeDictation(doc: Document): boolean {
  const composer = resolveDictateComposer(doc);
  const button = composer === null ? null : findDictateButton(composer);
  if (button === null) return false;
  button.click();
  return true;
}
