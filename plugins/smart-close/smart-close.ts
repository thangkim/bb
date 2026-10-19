export const RIGHT_PANEL_TOOLBAR_SELECTOR =
  '[role="toolbar"][aria-label="Right panel views"]';

export const OPEN_MODAL_SELECTOR = [
  '[aria-modal="true"]:not([inert]):not([inert] *):not([data-state="closed"])',
  '[role="dialog"][data-state="open"]:not([inert]):not([inert] *)',
].join(", ");

export const FOCUS_SETTLE_MS = 600;

export const PANE_CLOSE_SHORTCUT = { key: "X", code: "KeyX" } as const;

export function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function hasModifiers(
  event: KeyboardEvent,
  isMac: boolean,
  shift: boolean,
): boolean {
  return (
    event.metaKey === isMac &&
    event.ctrlKey === !isMac &&
    event.altKey === false &&
    event.shiftKey === shift
  );
}

export function isCloseShortcut(event: KeyboardEvent, isMac: boolean): boolean {
  return (
    (event.code === "KeyW" || event.key.toLowerCase() === "w") &&
    hasModifiers(event, isMac, false)
  );
}

export function rightPanelOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const aside = target.closest("aside");
  if (aside === null) return null;
  return aside.querySelector(RIGHT_PANEL_TOOLBAR_SELECTOR) === null
    ? null
    : aside;
}

function isOpenPanel(panel: HTMLElement): boolean {
  return (
    panel.isConnected &&
    panel.getAttribute("aria-hidden") !== "true" &&
    !panel.inert
  );
}

function dispatchPaneClose(isMac: boolean): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: PANE_CLOSE_SHORTCUT.key,
      code: PANE_CLOSE_SHORTCUT.code,
      metaKey: isMac,
      ctrlKey: !isMac,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

export function mountSmartClose(signal: AbortSignal): () => void {
  if (signal.aborted) return () => {};
  const isMac = isMacPlatform();
  let lastPanel = rightPanelOf(document.activeElement);
  let lastPointerAt = Number.NEGATIVE_INFINITY;
  let lastPassThroughAt = Number.NEGATIVE_INFINITY;

  const activePanel = (): HTMLElement | null =>
    lastPanel !== null && isOpenPanel(lastPanel) ? lastPanel : null;

  const onPointerDown = (event: PointerEvent) => {
    lastPanel = rightPanelOf(event.target);
    lastPointerAt = performance.now();
  };
  const onFocusIn = (event: FocusEvent) => {
    const now = performance.now();
    if (
      now - lastPointerAt < FOCUS_SETTLE_MS ||
      now - lastPassThroughAt < FOCUS_SETTLE_MS
    ) {
      return;
    }
    lastPanel = rightPanelOf(event.target);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (!isCloseShortcut(event, isMac)) return;
    if (document.querySelector(OPEN_MODAL_SELECTOR) !== null) return;
    if (activePanel() !== null) {
      lastPassThroughAt = performance.now();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) dispatchPaneClose(isMac);
  };

  const dispose = () => {
    signal.removeEventListener("abort", dispose);
    window.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("focusin", onFocusIn, true);
  };

  window.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("focusin", onFocusIn, true);
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
