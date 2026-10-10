import { useEffect, useRef, type RefObject } from "react";

export const PANE_WIDTH_STORAGE_KEY = "bb-my-tasks:pane-width";
export const MIN_PANE_WIDTH_PX = 240;
export const MIN_OTHER_PANES_WIDTH_PX = 240;
const CELL_ATTRIBUTE = "data-my-tasks-pane-width";
const STYLE_ID = "bb-my-tasks-pane-width";
const PANE_SELECTOR = "[data-split-pane-id]";
const GRID_ROOT_SELECTOR = "[data-split-resize-grid-root]";
const DIVIDER_ATTRIBUTE = "data-split-resize-grid-boundary";
const ROW_DIVIDER_SELECTOR = `:scope > [${DIVIDER_ATTRIBUTE}][aria-orientation="vertical"]`;
const HIT_TARGET_SELECTOR = "[data-split-divider-hit-target]";

export function parsePaneWidth(raw: string | null): number | null {
  if (raw === null) return null;
  const width = Number(raw);
  return Number.isFinite(width) && width >= MIN_PANE_WIDTH_PX
    ? Math.round(width)
    : null;
}

function readPaneWidth(): number | null {
  try {
    return parsePaneWidth(window.localStorage.getItem(PANE_WIDTH_STORAGE_KEY));
  } catch {
    return null;
  }
}

function storePaneWidth(width: number): void {
  try {
    window.localStorage.setItem(PANE_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {}
}

function isRowSplitRoot(root: Element): boolean {
  return [...root.querySelectorAll(ROW_DIVIDER_SELECTOR)].some(
    (divider) => divider.querySelector(HIT_TARGET_SELECTOR) !== null,
  );
}

export function rowCellOf(element: Element): HTMLElement | null {
  let node = element.closest<HTMLElement>(PANE_SELECTOR);
  while (node !== null) {
    const cell = node.parentElement;
    const root = cell?.parentElement;
    if (!cell || !root?.matches(GRID_ROOT_SELECTOR)) return null;
    if (isRowSplitRoot(root)) return cell;
    node = root;
  }
  return null;
}

export interface RowMeasurement {
  rootWidth: number;
  fixedWidth: number;
  otherGrow: number;
}

export function pinnedFlexGrow(
  width: number,
  { rootWidth, fixedWidth, otherGrow }: RowMeasurement,
): number | null {
  const free = rootWidth - fixedWidth;
  if (otherGrow <= 0 || free <= 0) return null;
  const target = Math.min(
    Math.max(width, MIN_PANE_WIDTH_PX),
    free - MIN_OTHER_PANES_WIDTH_PX,
  );
  if (target <= 0) return null;
  return (target * otherGrow) / (free - target);
}

function measureRow(cell: HTMLElement): RowMeasurement | null {
  const root = cell.parentElement;
  if (!root) return null;
  let fixedWidth = 0;
  let otherGrow = 0;
  for (const child of root.children) {
    if (child === cell || !(child instanceof HTMLElement)) continue;
    const grow = Number.parseFloat(getComputedStyle(child).flexGrow);
    if (child.hasAttribute(DIVIDER_ATTRIBUTE) || !(grow > 0)) {
      fixedWidth += child.getBoundingClientRect().width;
    } else {
      otherGrow += grow;
    }
  }
  return { rootWidth: root.getBoundingClientRect().width, fixedWidth, otherGrow };
}

function adjacentDividers(cell: HTMLElement): HTMLElement[] {
  return [cell.previousElementSibling, cell.nextElementSibling].filter(
    (sibling): sibling is HTMLElement =>
      sibling instanceof HTMLElement && sibling.hasAttribute(DIVIDER_ATTRIBUTE),
  );
}

function isDragging(cell: HTMLElement): boolean {
  return adjacentDividers(cell).some(
    (divider) => divider.dataset.dragging === "true",
  );
}

export function inlineFlexGrow(cell: HTMLElement): number | null {
  const grow = Number.parseFloat(
    cell.style.flexGrow || cell.style.flex.split(" ")[0] || "",
  );
  return Number.isFinite(grow) && grow > 0 ? grow : null;
}

function pin(cell: HTMLElement, grow: number): void {
  const css = `${GRID_ROOT_SELECTOR} > [${CELL_ATTRIBUTE}][${CELL_ATTRIBUTE}] { flex-grow: ${grow.toFixed(6)} !important; }`;
  let style = document.getElementById(STYLE_ID);
  if (!(style instanceof HTMLStyleElement)) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.append(style);
  }
  if (style.textContent !== css) style.textContent = css;
  if (!cell.hasAttribute(CELL_ATTRIBUTE)) cell.setAttribute(CELL_ATTRIBUTE, "");
}

function unpin(cell: HTMLElement | null): void {
  cell?.removeAttribute(CELL_ATTRIBUTE);
}

interface DragState {
  startStyle: string | null;
}

export function usePersistentPaneWidth(
  ref: RefObject<HTMLElement | null>,
  layoutKey: unknown,
): void {
  const sync = useRef<() => void>(() => {});

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let cell: HTMLElement | null = null;
    let drag: DragState | null = null;
    let observedRoot: HTMLElement | null = null;
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => record.type === "childList")) {
        observedRoot = null;
      }
      sync.current();
    });
    const resizes =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => sync.current());

    const disconnect = () => {
      observedRoot = null;
      mutations.disconnect();
      resizes?.disconnect();
    };

    const observe = (root: HTMLElement) => {
      if (root === observedRoot) return;
      disconnect();
      observedRoot = root;
      mutations.observe(root, { childList: true });
      for (const child of root.children) {
        mutations.observe(child, {
          attributes: true,
          attributeFilter: ["style", "data-dragging"],
        });
      }
      resizes?.observe(root);
    };

    sync.current = () => {
      const nextCell = rowCellOf(element);
      if (nextCell !== cell) {
        unpin(cell);
        cell = nextCell;
        drag = null;
      }
      if (!cell?.parentElement) {
        disconnect();
        return;
      }
      observe(cell.parentElement);
      if (isDragging(cell)) {
        drag ??= { startStyle: cell.getAttribute("style") };
        const grow = inlineFlexGrow(cell);
        if (cell.getAttribute("style") !== drag.startStyle && grow !== null) {
          pin(cell, grow);
        }
        return;
      }
      if (drag !== null) {
        drag = null;
        storePaneWidth(cell.getBoundingClientRect().width);
      }
      const width = readPaneWidth();
      const measurement = width === null ? null : measureRow(cell);
      const grow =
        width === null || measurement === null
          ? null
          : pinnedFlexGrow(width, measurement);
      if (grow === null) unpin(cell);
      else pin(cell, grow);
    };

    sync.current();
    return () => {
      disconnect();
      unpin(cell);
      sync.current = () => {};
    };
  }, [ref]);

  useEffect(() => {
    sync.current();
  }, [layoutKey]);
}
