export const THREAD_FIND_BAR_ATTRIBUTE = "data-thread-find";
export const TIMELINE_RENDER_ALL_ATTRIBUTE = "data-bb-timeline-render-all";
export const THREAD_FIND_SEARCH_ROOT_SELECTOR =
  '[data-timeline-row-list="top-level"]';
export const THREAD_FIND_IGNORED_SELECTOR =
  "[data-scroll-footer], [data-scroll-overlay]";

const THREAD_WINDOW_SELECTOR = "[data-thread-window]";
const MAIN_THREAD_WINDOW_SELECTOR =
  "[data-thread-window]:not([data-surface-tone])";
const PANE_WITH_FOCUS_STATE_SELECTOR = "[data-split-pane-id][data-focused]";
const HIDDEN_ANCESTOR_SELECTOR = '[aria-hidden="true"], [inert]';
const NATIVE_FIND_OWNER_SELECTOR = "[data-app-browser], [data-app-terminal]";
const OPEN_MODAL_SELECTOR = [
  '[aria-modal="true"]:not([inert]):not([inert] *):not([data-state="closed"])',
  '[role="dialog"][data-state="open"]:not([inert]):not([inert] *)',
].join(", ");
const SCROLL_FOOTER_SELECTOR = "[data-scroll-footer]";

function isSearchableThreadWindow(element: HTMLElement): boolean {
  return (
    element.querySelector(THREAD_FIND_SEARCH_ROOT_SELECTOR) !== null &&
    element.closest(HIDDEN_ANCESTOR_SELECTOR) === null
  );
}

function isInFocusedPane(element: HTMLElement): boolean {
  const pane = element.closest(PANE_WITH_FOCUS_STATE_SELECTOR);
  return pane === null || pane.getAttribute("data-focused") === "true";
}

export function resolveThreadWindow(
  doc: Document,
  focus: Element | null,
): HTMLElement | null {
  const focused = focus?.closest<HTMLElement>(THREAD_WINDOW_SELECTOR) ?? null;
  if (focused !== null && isSearchableThreadWindow(focused)) return focused;
  const candidates = Array.from(
    doc.querySelectorAll<HTMLElement>(MAIN_THREAD_WINDOW_SELECTOR),
  );
  return (
    candidates.find(
      (candidate) =>
        isSearchableThreadWindow(candidate) && isInFocusedPane(candidate),
    ) ?? null
  );
}

export function isMacPlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/u.test(platform);
}

export function isFindShortcut(event: KeyboardEvent, isMac: boolean): boolean {
  if (event.key.toLowerCase() !== "f" || event.altKey || event.shiftKey) {
    return false;
  }
  return isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

export function isFindAgainShortcut(
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey">,
): boolean {
  return (
    event.key.toLowerCase() === "g" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey
  );
}

export function isInsideFindBar(element: Element | null): boolean {
  return element?.closest(`[${THREAD_FIND_BAR_ATTRIBUTE}]`) != null;
}

export type FindShortcutTarget =
  | { kind: "find-bar" }
  | { kind: "thread"; threadWindow: HTMLElement };

export function resolveFindShortcutTarget(
  event: KeyboardEvent,
  doc: Document,
  isMac: boolean,
): FindShortcutTarget | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (!isFindShortcut(event, isMac)) return null;
  const target = event.target instanceof Element ? event.target : null;
  if (isInsideFindBar(target)) return { kind: "find-bar" };
  if (target?.closest(NATIVE_FIND_OWNER_SELECTOR) != null) return null;
  if (doc.querySelector(OPEN_MODAL_SELECTOR) !== null) return null;
  const threadWindow = resolveThreadWindow(doc, target);
  return threadWindow === null ? null : { kind: "thread", threadWindow };
}

function isVerticalScroller(element: HTMLElement): boolean {
  const { overflowY } = getComputedStyle(element);
  return (
    (overflowY === "auto" || overflowY === "scroll") &&
    element.scrollHeight > element.clientHeight
  );
}

export function findVerticalScroller(
  from: Element,
  boundary: Element,
): HTMLElement | null {
  for (
    let element = from.parentElement;
    element !== null && boundary.contains(element);
    element = element.parentElement
  ) {
    if (isVerticalScroller(element)) return element;
  }
  return null;
}

interface VerticalViewport {
  top: number;
  bottom: number;
}

function visibleViewport(scroller: HTMLElement): VerticalViewport {
  const rect = scroller.getBoundingClientRect();
  let bottom = rect.bottom;
  for (const footer of scroller.querySelectorAll(SCROLL_FOOTER_SELECTOR)) {
    if (findVerticalScroller(footer, scroller) !== scroller) continue;
    const footerTop = footer.getBoundingClientRect().top;
    if (footerTop > rect.top && footerTop < bottom) bottom = footerTop;
  }
  return { top: rect.top, bottom };
}

export function firstMatchBelowViewportTop(
  ranges: readonly Range[],
  scroller: HTMLElement | null,
): number {
  if (scroller === null) return 0;
  const top = scroller.getBoundingClientRect().top;
  const index = ranges.findIndex(
    (range) => range.getBoundingClientRect().top >= top,
  );
  return index === -1 ? 0 : index;
}

function scrollBy(scroller: HTMLElement, delta: number): void {
  scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: Math.sign(delta) }));
  const previous = scroller.scrollTop;
  scroller.scrollTop = previous + delta;
  if (scroller.scrollTop !== previous) {
    scroller.dispatchEvent(new Event("scroll"));
  }
}

export function revealRange(range: Range, boundary: HTMLElement): void {
  const start = range.startContainer.parentElement;
  if (start === null) return;
  for (
    let scroller = findVerticalScroller(start, boundary);
    scroller !== null;
    scroller = findVerticalScroller(scroller, boundary)
  ) {
    const viewport = visibleViewport(scroller);
    const rect = range.getBoundingClientRect();
    if (rect.top >= viewport.top && rect.bottom <= viewport.bottom) continue;
    const delta =
      rect.top + rect.height / 2 - (viewport.top + viewport.bottom) / 2;
    scrollBy(scroller, delta);
  }
}
