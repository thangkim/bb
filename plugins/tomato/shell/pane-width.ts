import { useEffect, useRef, type RefObject } from "react";

export const PANE_WIDTH_STORAGE_KEY = "bb-tomato:pane-width";
export const MIN_PANE_WIDTH_PX = 240;
export const MIN_OTHER_PANES_WIDTH_PX = 240;
const CELL_ATTRIBUTE = "data-tomato-pane-width";
const ROW_ATTRIBUTE = "data-tomato-pane-row";
const STYLE_ID = "bb-tomato-pane-width";
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
    window.localStorage.setItem(
      PANE_WIDTH_STORAGE_KEY,
      String(Math.round(width)),
    );
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

interface RowSibling {
  nthChild: number;
  grow: number;
}

export interface RowMeasurement {
  rootWidth: number;
  fixedWidth: number;
  siblings: readonly RowSibling[];
}

export interface RowGrows {
  self: number;
  siblings: readonly RowSibling[];
}

function normalizedRowGrows(
  self: number,
  siblings: readonly RowSibling[],
): RowGrows | null {
  const total = siblings.reduce((sum, sibling) => sum + sibling.grow, self);
  if (!(self > 0) || !(total > 0)) return null;
  return {
    self: self / total,
    siblings: siblings.map(({ nthChild, grow }) => ({
      nthChild,
      grow: grow / total,
    })),
  };
}

export function pinnedRowGrows(
  width: number,
  { rootWidth, fixedWidth, siblings }: RowMeasurement,
): RowGrows | null {
  const free = rootWidth - fixedWidth;
  const otherGrow = siblings.reduce((sum, sibling) => sum + sibling.grow, 0);
  if (otherGrow <= 0 || free <= 0) return null;
  const target = Math.min(
    Math.max(width, MIN_PANE_WIDTH_PX),
    free - MIN_OTHER_PANES_WIDTH_PX,
  );
  if (target <= 0) return null;
  const share = target / free;
  return {
    self: share,
    siblings: siblings.map(({ nthChild, grow }) => ({
      nthChild,
      grow: (grow * (1 - share)) / otherGrow,
    })),
  };
}

function isHidden(element: HTMLElement): boolean {
  return getComputedStyle(element).display === "none";
}

function cellGrow(cell: HTMLElement): number | null {
  const computed = Number.parseFloat(getComputedStyle(cell).flexGrow);
  if (!(computed > 0)) return null;
  return inlineFlexGrow(cell) ?? computed;
}

function measureRow(cell: HTMLElement): RowMeasurement | null {
  const root = cell.parentElement;
  if (!root) return null;
  let fixedWidth = 0;
  const siblings: RowSibling[] = [];
  [...root.children].forEach((child, index) => {
    if (child === cell || !(child instanceof HTMLElement)) return;
    if (isHidden(child)) return;
    const grow = child.hasAttribute(DIVIDER_ATTRIBUTE) ? null : cellGrow(child);
    if (grow === null) fixedWidth += child.getBoundingClientRect().width;
    else siblings.push({ nthChild: index + 1, grow });
  });
  return {
    rootWidth: root.getBoundingClientRect().width,
    fixedWidth,
    siblings,
  };
}

function liveRowGrows(cell: HTMLElement): RowGrows | null {
  const self = inlineFlexGrow(cell);
  const measurement = measureRow(cell);
  return self === null || measurement === null
    ? null
    : normalizedRowGrows(self, measurement.siblings);
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

function pin(cell: HTMLElement, grows: RowGrows): void {
  const root = cell.parentElement;
  if (!root) return;
  const css = [
    `${GRID_ROOT_SELECTOR} > [${CELL_ATTRIBUTE}][${CELL_ATTRIBUTE}] { flex-grow: ${grows.self.toFixed(6)} !important; }`,
    ...grows.siblings.map(
      ({ nthChild, grow }) =>
        `${GRID_ROOT_SELECTOR}[${ROW_ATTRIBUTE}] > :nth-child(${nthChild}) { flex-grow: ${grow.toFixed(6)} !important; }`,
    ),
  ].join("\n");
  let style = document.getElementById(STYLE_ID);
  if (!(style instanceof HTMLStyleElement)) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.append(style);
  }
  if (style.textContent !== css) style.textContent = css;
  if (!cell.hasAttribute(CELL_ATTRIBUTE)) cell.setAttribute(CELL_ATTRIBUTE, "");
  if (!root.hasAttribute(ROW_ATTRIBUTE)) root.setAttribute(ROW_ATTRIBUTE, "");
}

function unpin(cell: HTMLElement | null): void {
  cell?.removeAttribute(CELL_ATTRIBUTE);
  cell?.parentElement?.removeAttribute(ROW_ATTRIBUTE);
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
      for (const child of root.children) resizes?.observe(child);
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
        const grows =
          cell.getAttribute("style") === drag.startStyle
            ? null
            : liveRowGrows(cell);
        if (grows !== null) pin(cell, grows);
        return;
      }
      if (drag !== null) {
        drag = null;
        const draggedWidth = cell.getBoundingClientRect().width;
        if (draggedWidth > 0) storePaneWidth(draggedWidth);
      }
      const width = isHidden(cell) ? null : readPaneWidth();
      const measurement = width === null ? null : measureRow(cell);
      const grows =
        width === null || measurement === null
          ? null
          : pinnedRowGrows(width, measurement);
      if (grows === null) unpin(cell);
      else pin(cell, grows);
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
