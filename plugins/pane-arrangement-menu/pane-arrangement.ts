import type { PluginSidebarSplitLayout } from "@get-bb/plugin-sdk/app";

export type PaneSide = "left" | "right" | "top" | "bottom";
export type MenuItemKind = "full-screen" | "close" | PaneSide;

export const FULL_SCREEN_TITLE = "Full Screen";
export const CLOSE_PANE_TITLE = "Close pane";

export const MOVE_ACTIONS: ReadonlyArray<{
  side: PaneSide;
  title: string;
  coreLabel: string;
}> = [
  { side: "left", title: "Move pane left", coreLabel: "Move left" },
  { side: "right", title: "Move pane right", coreLabel: "Move right" },
  { side: "top", title: "Move pane to top", coreLabel: "Move top" },
  { side: "bottom", title: "Move pane to bottom", coreLabel: "Move bottom" },
];

export const ARRANGEMENT_BUTTON_SELECTOR =
  "[data-thread-header-pane-actions] > button[aria-pressed]";
export const CLOSE_BUTTON_SELECTOR =
  '[data-thread-header-pane-actions] > button[aria-label="Close pane"]';
export const ARRANGEMENT_MENU_SELECTOR =
  '[role="menu"][aria-label="Pane arrangement"]';
const PANE_SELECTOR = "[data-split-pane-id]";
const MENU_ITEM_SELECTOR = '[role="menuitem"]';
export const DECORATED_ATTRIBUTE = "data-pane-arrangement-menu";
const SHORTCUT_ATTRIBUTE = "data-pane-arrangement-shortcut";

export const HIDE_CORE_CSS = [
  `${ARRANGEMENT_BUTTON_SELECTOR} { display: none !important; }`,
  `${CLOSE_BUTTON_SELECTOR} { display: none !important; }`,
  `${ARRANGEMENT_MENU_SELECTOR} { visibility: hidden !important; }`,
].join("\n");

const KIND_BY_TITLE = new Map<string, MenuItemKind>([
  [FULL_SCREEN_TITLE, "full-screen"],
  [CLOSE_PANE_TITLE, "close"],
  ...MOVE_ACTIONS.map((action): [string, MenuItemKind] => [
    action.title,
    action.side,
  ]),
]);

export interface Arrangement {
  label: string;
  shortcut: string | null;
  isFullScreen: boolean;
}

export function readArrangement(button: HTMLButtonElement): Arrangement {
  const ariaLabel = button.getAttribute("aria-label") ?? FULL_SCREEN_TITLE;
  const match = /^(.*\S)\s+\(([^()]+)\)$/.exec(ariaLabel);
  return {
    label: match?.[1] ?? ariaLabel,
    shortcut: match?.[2] ?? null,
    isFullScreen: button.getAttribute("aria-pressed") === "true",
  };
}

export function arrangementButtonForTrigger(
  trigger: Element,
  selector = ARRANGEMENT_BUTTON_SELECTOR,
): HTMLButtonElement | null {
  return (
    trigger.closest("header")?.querySelector<HTMLButtonElement>(selector) ??
    null
  );
}

export function arrangementButtonsForThread(
  layout: PluginSidebarSplitLayout | null,
  threadId: string,
  selector = ARRANGEMENT_BUTTON_SELECTOR,
): HTMLButtonElement[] {
  if (layout === null) return [];
  const paneIds = layout.panes
    .filter((pane) => pane.threadId === threadId)
    .sort((a, b) => Number(b.isFocused) - Number(a.isFocused))
    .map((pane) => pane.paneId);
  const paneElements = [
    ...document.querySelectorAll<HTMLElement>(PANE_SELECTOR),
  ];
  const buttons = paneIds.flatMap((paneId) =>
    paneElements
      .filter((element) => element.dataset.splitPaneId === paneId)
      .flatMap((element) => [
        ...element.querySelectorAll<HTMLButtonElement>(selector),
      ]),
  );
  return [...new Set(buttons)];
}

function menuTrigger(item: Element): Element | null {
  const id = item.closest('[role="menu"]')?.getAttribute("aria-labelledby");
  return id ? document.getElementById(id) : null;
}

function itemKind(item: Element): MenuItemKind | null {
  return KIND_BY_TITLE.get(item.textContent?.trim() ?? "") ?? null;
}

function relabel(item: HTMLElement, label: string): void {
  for (const node of item.childNodes) {
    if (
      node.nodeType === Node.TEXT_NODE &&
      node.textContent?.trim() === FULL_SCREEN_TITLE
    ) {
      node.textContent = label;
      return;
    }
  }
}

function swapIcon(item: HTMLElement, button: HTMLButtonElement): void {
  const current = item.querySelector<HTMLElement>(":scope > [data-icon-root]");
  const source = button.querySelector<HTMLElement>("[data-icon-root]");
  if (current === null || source === null) return;
  if (current.dataset.icon === source.dataset.icon) return;
  const replacement = source.cloneNode(true);
  if (!(replacement instanceof Element)) return;
  replacement.setAttribute("aria-hidden", "true");
  current.style.setProperty("display", "none", "important");
  item.insertBefore(replacement, current);
}

function appendShortcut(item: HTMLElement, shortcut: string): void {
  const hint = document.createElement("span");
  hint.setAttribute(SHORTCUT_ATTRIBUTE, "");
  hint.className = "ml-auto pl-4 text-xs tracking-widest opacity-60";
  hint.textContent = shortcut;
  item.append(hint);
}

export function decorateMenuItem(
  item: HTMLElement,
  kind: MenuItemKind,
  button: HTMLButtonElement | null,
): void {
  item.setAttribute(DECORATED_ATTRIBUTE, kind);
  if (kind === "close") {
    if (button === null) item.style.setProperty("display", "none", "important");
    return;
  }
  const arrangement = button === null ? null : readArrangement(button);
  if (
    button === null ||
    arrangement === null ||
    (kind !== "full-screen" && arrangement.isFullScreen)
  ) {
    item.style.setProperty("display", "none", "important");
    return;
  }
  if (kind !== "full-screen") return;
  relabel(item, arrangement.label);
  swapIcon(item, button);
  if (arrangement.shortcut !== null) appendShortcut(item, arrangement.shortcut);
}

export interface DecorateResult {
  found: boolean;
  button: HTMLButtonElement | null;
}

export function decoratePluginMenuItems(root: Element): DecorateResult {
  const candidates = [
    ...(root.matches(MENU_ITEM_SELECTOR) ? [root] : []),
    ...root.querySelectorAll(MENU_ITEM_SELECTOR),
  ];
  const result: DecorateResult = { found: false, button: null };
  for (const item of candidates) {
    if (
      !(item instanceof HTMLElement) ||
      item.hasAttribute(DECORATED_ATTRIBUTE)
    )
      continue;
    const kind = itemKind(item);
    if (kind === null) continue;
    const trigger = menuTrigger(item);
    const button =
      trigger === null ? null : arrangementButtonForTrigger(trigger);
    decorateMenuItem(
      item,
      kind,
      kind === "close" && trigger !== null
        ? arrangementButtonForTrigger(trigger, CLOSE_BUTTON_SELECTOR)
        : button,
    );
    result.found = true;
    result.button = button;
  }
  return result;
}

function waitForElement<T extends Element>(
  find: () => T | null,
  timeoutMs: number,
): Promise<T | null> {
  const found = find();
  if (found !== null) return Promise.resolve(found);
  return new Promise((resolve) => {
    const finish = (element: T | null) => {
      observer.disconnect();
      window.clearTimeout(timeout);
      resolve(element);
    };
    const observer = new MutationObserver(() => {
      const element = find();
      if (element !== null) finish(element);
    });
    const timeout = window.setTimeout(() => finish(null), timeoutMs);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

export function toggleFullScreen(button: HTMLButtonElement): void {
  button.click();
}

export async function moveViaArrangementMenu(
  button: HTMLButtonElement,
  side: PaneSide,
  timeoutMs = 1000,
): Promise<boolean> {
  if (readArrangement(button).isFullScreen) return false;
  const label = MOVE_ACTIONS.find((action) => action.side === side)?.coreLabel;
  if (label === undefined) return false;
  button.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  );
  const target = await waitForElement(
    () =>
      document.querySelector<HTMLElement>(
        `${ARRANGEMENT_MENU_SELECTOR} [role="menuitem"][aria-label="${label}"]`,
      ),
    timeoutMs,
  );
  if (target === null) return false;
  target.click();
  return true;
}
