import {
  GRID_DIVIDER_ATTRIBUTE,
  GRID_ROOT_SELECTOR,
  PANE_SELECTOR,
  ROOT_ATTRIBUTE,
  type CollapsedPanes,
  type SplitGrid,
} from "./collapsed-panes";

export interface SplitDom {
  grids: SplitGrid[];
  roots: HTMLElement[];
  cells: HTMLElement[];
}

export function collapsedPaneElements(
  collapsed: CollapsedPanes,
): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(PANE_SELECTOR)].filter(
    (pane) => collapsed.has(pane.dataset.splitPaneId ?? ""),
  );
}

function ancestorGridRoots(pane: HTMLElement): HTMLElement[] {
  const roots: HTMLElement[] = [];
  let node: HTMLElement = pane;
  for (;;) {
    const root = node.parentElement?.parentElement;
    if (!root?.matches(GRID_ROOT_SELECTOR)) return roots;
    roots.push(root);
    node = root;
  }
}

function parseGrow(value: string): number | null {
  const grow = Number.parseFloat(value);
  return Number.isFinite(grow) && grow >= 0 ? grow : null;
}

function inlineGrow(cell: HTMLElement): number | null {
  return parseGrow(cell.style.flexGrow || cell.style.flex.split(" ")[0] || "");
}

function readCellGrow(cell: HTMLElement): { grow: number; pinned: boolean } {
  const inline = inlineGrow(cell);
  const effective = parseGrow(getComputedStyle(cell).flexGrow);
  if (inline === null) return { grow: effective ?? 1, pinned: false };
  if (effective === null) return { grow: inline, pinned: false };
  return { grow: effective, pinned: Math.abs(effective - inline) > 1e-6 };
}

function isCollapsedCell(cell: HTMLElement, collapsed: CollapsedPanes) {
  const panes = [...cell.querySelectorAll<HTMLElement>(PANE_SELECTOR)];
  return (
    panes.length > 0 &&
    panes.every((pane) => collapsed.has(pane.dataset.splitPaneId ?? ""))
  );
}

export function readSplitDom(collapsed: CollapsedPanes): SplitDom {
  const roots = [
    ...new Set(collapsedPaneElements(collapsed).flatMap(ancestorGridRoots)),
  ];
  const cells: HTMLElement[] = [];
  const grids = roots.map((root, index) => {
    const children = [...root.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        !child.hasAttribute(GRID_DIVIDER_ATTRIBUTE),
    );
    cells.push(...children);
    return {
      rootId: String(index),
      cells: children.map((cell) => ({
        nthChild: [...root.children].indexOf(cell) + 1,
        ...readCellGrow(cell),
        collapsed: isCollapsedCell(cell, collapsed),
      })),
    };
  });
  return { grids, roots, cells };
}

export function stampGridRoots(roots: readonly HTMLElement[]): void {
  const keep = new Set(roots);
  for (const stale of document.querySelectorAll<HTMLElement>(
    `[${ROOT_ATTRIBUTE}]`,
  )) {
    if (!keep.has(stale)) stale.removeAttribute(ROOT_ATTRIBUTE);
  }
  roots.forEach((root, index) => {
    if (root.getAttribute(ROOT_ATTRIBUTE) !== String(index)) {
      root.setAttribute(ROOT_ATTRIBUTE, String(index));
    }
  });
}
