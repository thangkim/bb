export interface SelectionShortcut {
  key: string;
  label: string;
}

export const SELECTION_SHORTCUTS: readonly SelectionShortcut[] = [
  { key: "a", label: "Add to chat" },
  { key: "r", label: "Reply in side chat" },
];

export const SHORTCUT_HINT_ATTRIBUTE = "data-bb-selection-menu-shortcut";

export const SELECTION_MENU_SELECTOR =
  '[data-radix-popper-content-wrapper] > [role="dialog"][data-bb-portaled-overlay][data-state="open"]';

interface ShortcutButton {
  shortcut: SelectionShortcut;
  button: HTMLButtonElement;
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  return (
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}

function isBareKeyEvent(event: KeyboardEvent): boolean {
  return (
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.repeat &&
    !event.isComposing
  );
}

function ownLabel(button: HTMLButtonElement): string {
  let label = "";
  for (const node of button.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) label += node.textContent ?? "";
  }
  return label.replace(/\s+/g, " ").trim();
}

function openSelectionMenus(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(SELECTION_MENU_SELECTOR),
  );
}

function shortcutButtons(menu: HTMLElement): ShortcutButton[] {
  const matches: ShortcutButton[] = [];
  for (const button of menu.querySelectorAll("button")) {
    const label = ownLabel(button);
    const shortcut = SELECTION_SHORTCUTS.find(
      (candidate) => candidate.label === label,
    );
    if (shortcut !== undefined) matches.push({ shortcut, button });
  }
  return matches;
}

function focusedElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

export function mountSelectionShortcuts(signal: AbortSignal): () => void {
  let decorated = new Set<HTMLButtonElement>();
  let disposed = false;

  const setHint = (button: HTMLButtonElement, key: string) => {
    const hint = key.toUpperCase();
    if (button.getAttribute(SHORTCUT_HINT_ATTRIBUTE) !== hint) {
      button.setAttribute(SHORTCUT_HINT_ATTRIBUTE, hint);
    }
    if (button.getAttribute("aria-keyshortcuts") !== hint) {
      button.setAttribute("aria-keyshortcuts", hint);
    }
  };
  const clearHint = (button: HTMLButtonElement) => {
    button.removeAttribute(SHORTCUT_HINT_ATTRIBUTE);
    button.removeAttribute("aria-keyshortcuts");
  };

  const menuObserver = new MutationObserver(() => sync());
  const bodyObserver = new MutationObserver(() => sync());

  function sync(focused: Element | null = document.activeElement): void {
    if (disposed) return;
    const menus = openSelectionMenus();
    menuObserver.disconnect();
    for (const menu of menus) {
      menuObserver.observe(menu, {
        attributeFilter: ["data-state"],
        characterData: true,
        childList: true,
        subtree: true,
      });
    }
    const next = new Set<HTMLButtonElement>();
    if (!isEditableKeyboardTarget(focused)) {
      for (const menu of menus) {
        for (const { shortcut, button } of shortcutButtons(menu)) {
          setHint(button, shortcut.key);
          next.add(button);
        }
      }
    }
    for (const button of decorated) {
      if (!next.has(button)) clearHint(button);
    }
    decorated = next;
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isBareKeyEvent(event)) return;
    const key = event.key.toLowerCase();
    if (!SELECTION_SHORTCUTS.some((shortcut) => shortcut.key === key)) return;
    if (
      isEditableKeyboardTarget(event.target) ||
      isEditableKeyboardTarget(document.activeElement)
    ) {
      return;
    }
    const menu = openSelectionMenus().at(-1);
    if (menu === undefined) return;
    const match = shortcutButtons(menu).find(
      ({ shortcut }) => shortcut.key === key,
    );
    if (match === undefined || match.button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    match.button.click();
  };
  const onFocusIn = (event: FocusEvent) => sync(focusedElement(event.target));
  const onFocusOut = (event: FocusEvent) =>
    sync(focusedElement(event.relatedTarget));

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose);
    window.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    bodyObserver.disconnect();
    menuObserver.disconnect();
    for (const button of decorated) clearHint(button);
    decorated.clear();
  };

  if (signal.aborted) {
    disposed = true;
    return () => {};
  }
  window.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  bodyObserver.observe(document.body, { childList: true });
  signal.addEventListener("abort", dispose, { once: true });
  sync();
  return dispose;
}
