export const THREAD_FIND_BAR_ATTRIBUTE = "data-thread-find";
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
const TIMELINE_ITEMS_SELECTOR = ":scope > [data-timeline-items]";
const TIMELINE_ROW_ID_ATTRIBUTE = "data-timeline-row-id";
const ROW_MOUNT_MAX_STEPS = 400;
const ROW_MOUNT_STALL_TIMEOUT_MS = 4_000;
const ROW_MOUNT_MIN_STEP_PX = 48;

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

function timelineItemsContainer(list: Element): Element {
  return list.querySelector(TIMELINE_ITEMS_SELECTOR) ?? list;
}

export function rowIdOf(row: Element): string | null {
  return row.getAttribute(TIMELINE_ROW_ID_ATTRIBUTE);
}

export function listTopLevelRows(list: Element): HTMLElement[] {
  return Array.from(timelineItemsContainer(list).children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      child.hasAttribute(TIMELINE_ROW_ID_ATTRIBUTE),
  );
}

export function topLevelRowOf(node: Node, list: Element): HTMLElement | null {
  const container = timelineItemsContainer(list);
  for (
    let element = node instanceof Element ? node : node.parentElement;
    element !== null && element !== container;
    element = element.parentElement
  ) {
    if (
      element.parentElement === container &&
      element instanceof HTMLElement &&
      element.hasAttribute(TIMELINE_ROW_ID_ATTRIBUTE)
    ) {
      return element;
    }
  }
  return null;
}

export function findTopLevelRow(
  list: Element,
  rowId: string,
): HTMLElement | null {
  return listTopLevelRows(list).find((row) => rowIdOf(row) === rowId) ?? null;
}

export function lastRowPositionAboveViewBottom(
  rows: readonly HTMLElement[],
  positions: readonly number[],
  scroller: HTMLElement | null,
): number {
  if (scroller === null) return positions.at(-1) ?? -1;
  const { bottom } = visibleViewport(scroller);
  let last = -1;
  rows.forEach((row, index) => {
    const position = positions[index];
    if (position === undefined) return;
    if (row.getBoundingClientRect().top < bottom)
      last = Math.max(last, position);
  });
  return last;
}

export function isRangeBelowViewTop(
  range: Range,
  scroller: HTMLElement | null,
): boolean {
  if (scroller === null) return true;
  return (
    range.getBoundingClientRect().top >= scroller.getBoundingClientRect().top
  );
}

export interface RowMountRequest {
  list: Element;
  scroller: HTMLElement;
  rowId: string;
  targetPosition: number;
  rowCount: number;
  positionOf: (rowId: string) => number | null;
  signal: AbortSignal;
}

interface PositionWindow {
  first: number;
  last: number;
}

function knownPositions(
  rows: readonly HTMLElement[],
  positionOf: (rowId: string) => number | null,
): number[] {
  return rows.flatMap((row) => {
    const id = rowIdOf(row);
    const position = id === null ? null : positionOf(id);
    return position === null ? [] : [position];
  });
}

function mountedPositionWindow(
  list: Element,
  scroller: HTMLElement,
  positionOf: (rowId: string) => number | null,
): PositionWindow | null {
  const rows = listTopLevelRows(list);
  const viewport = visibleViewport(scroller);
  const visible = rows.filter((row) => {
    const rect = row.getBoundingClientRect();
    return rect.bottom > viewport.top && rect.top < viewport.bottom;
  });
  const positions = knownPositions(visible, positionOf);
  const candidates =
    positions.length > 0 ? positions : knownPositions(rows, positionOf);
  if (candidates.length === 0) return null;
  return { first: Math.min(...candidates), last: Math.max(...candidates) };
}

function averageRowHeight(list: Element, rowCount: number): number {
  const height = timelineItemsContainer(list).getBoundingClientRect().height;
  return height / Math.max(1, rowCount);
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export async function scrollUntilRowMounted({
  list,
  scroller,
  rowId,
  targetPosition,
  rowCount,
  positionOf,
  signal,
}: RowMountRequest): Promise<HTMLElement | null> {
  let previousDirection = 0;
  let lastDistance = 0;
  let stepLimit = Number.POSITIVE_INFINITY;
  let stalledSince: number | null = null;
  for (let step = 0; step < ROW_MOUNT_MAX_STEPS; step += 1) {
    if (signal.aborted || !list.isConnected) return null;
    const mounted = findTopLevelRow(list, rowId);
    if (mounted !== null) return mounted;
    const mountedWindow = mountedPositionWindow(list, scroller, positionOf);
    const direction =
      mountedWindow === null || targetPosition < mountedWindow.first ? -1 : 1;
    const rowsAway =
      mountedWindow === null
        ? 0
        : direction < 0
          ? mountedWindow.first - targetPosition
          : targetPosition - mountedWindow.last;
    if (previousDirection !== 0 && direction !== previousDirection) {
      stepLimit = Math.max(ROW_MOUNT_MIN_STEP_PX, lastDistance / 2);
    }
    const distance = Math.min(
      stepLimit,
      Math.max(
        scroller.clientHeight / 2,
        ROW_MOUNT_MIN_STEP_PX,
        rowsAway * averageRowHeight(list, rowCount),
      ),
    );
    previousDirection = direction;
    lastDistance = distance;
    const before = scroller.scrollTop;
    scrollBy(scroller, direction * distance);
    if (scroller.scrollTop === before) {
      stalledSince ??= performance.now();
      if (performance.now() - stalledSince > ROW_MOUNT_STALL_TIMEOUT_MS) {
        return null;
      }
    } else {
      stalledSince = null;
    }
    await nextAnimationFrame();
    await nextAnimationFrame();
  }
  return null;
}
