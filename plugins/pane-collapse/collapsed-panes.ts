import type { PluginSidebarSplitLayout } from "@get-bb/plugin-sdk/app";

type Pane = PluginSidebarSplitLayout["panes"][number];

export type CollapsedPanes = ReadonlySet<string>;

export const COLLAPSED_PANE_SIZE_PX = 36;
export const PANE_SELECTOR = "[data-split-pane-id]";
export const STRIP_ATTRIBUTE = "data-pane-collapse-strip";
export const ROOT_ATTRIBUTE = "data-pane-collapse-root";
export const GRID_ROOT_SELECTOR = "[data-split-resize-grid-root]";
export const GRID_DIVIDER_ATTRIBUTE = "data-split-resize-grid-boundary";

export interface CollapsedPaneStore {
  get(): CollapsedPanes;
  set(next: CollapsedPanes): void;
  subscribe(listener: () => void): () => void;
}

export function createCollapsedPaneStore(): CollapsedPaneStore {
  let state: CollapsedPanes = new Set();
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function withPane(collapsed: CollapsedPanes, paneId: string) {
  return collapsed.has(paneId) ? collapsed : new Set([...collapsed, paneId]);
}

export function withoutPane(collapsed: CollapsedPanes, paneId: string) {
  if (!collapsed.has(paneId)) return collapsed;
  const next = new Set(collapsed);
  next.delete(paneId);
  return next;
}

export function pruneCollapsed(
  collapsed: CollapsedPanes,
  layout: PluginSidebarSplitLayout | null,
): CollapsedPanes {
  if (collapsed.size === 0) return collapsed;
  const live = new Set(layout?.panes.map((pane) => pane.paneId) ?? []);
  const kept = [...collapsed].filter((paneId) => live.has(paneId));
  return kept.length === collapsed.size ? collapsed : new Set(kept);
}

export function canCollapse(
  layout: PluginSidebarSplitLayout | null,
  collapsed: CollapsedPanes,
  paneId: string,
): boolean {
  if (layout === null || collapsed.has(paneId)) return false;
  if (!layout.panes.some((pane) => pane.paneId === paneId)) return false;
  return layout.panes.some(
    (pane) => pane.paneId !== paneId && !collapsed.has(pane.paneId),
  );
}

function center(pane: Pane): { x: number; y: number } {
  return {
    x: pane.rect.x + pane.rect.width / 2,
    y: pane.rect.y + pane.rect.height / 2,
  };
}

export function focusTargetAfterCollapse(
  layout: PluginSidebarSplitLayout,
  collapsed: CollapsedPanes,
  paneId: string,
): string | null {
  const source = layout.panes.find((pane) => pane.paneId === paneId);
  if (source === undefined) return null;
  const from = center(source);
  let best: { threadId: string; distance: number } | null = null;
  for (const pane of layout.panes) {
    if (pane.paneId === paneId || collapsed.has(pane.paneId)) continue;
    if (pane.threadId === null) continue;
    const to = center(pane);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (best === null || distance < best.distance) {
      best = { threadId: pane.threadId, distance };
    }
  }
  return best?.threadId ?? null;
}

export function newlyFocusedCollapsedPane(
  previousFocusedPaneId: string | null,
  layout: PluginSidebarSplitLayout | null,
  collapsed: CollapsedPanes,
): { focusedPaneId: string | null; expand: string | null } {
  const focusedPaneId =
    layout?.panes.find((pane) => pane.isFocused)?.paneId ?? null;
  const expand =
    focusedPaneId !== null &&
    focusedPaneId !== previousFocusedPaneId &&
    collapsed.has(focusedPaneId)
      ? focusedPaneId
      : null;
  return { focusedPaneId, expand };
}

export interface SplitCell {
  nthChild: number;
  grow: number;
  pinned: boolean;
  collapsed: boolean;
}

export interface SplitGrid {
  rootId: string;
  cells: readonly SplitCell[];
}

export function collapsedLayoutCss(grids: readonly SplitGrid[]): string {
  const rules = [
    `${PANE_SELECTOR}[data-maximized] > [${STRIP_ATTRIBUTE}] { display: none !important; }`,
  ];
  for (const grid of grids) {
    const root = `[${ROOT_ATTRIBUTE}="${grid.rootId}"]`;
    const scaled = grid.cells.filter((cell) => !cell.collapsed && !cell.pinned);
    const total = scaled.reduce((sum, cell) => sum + cell.grow, 0);
    for (const cell of grid.cells) {
      const child = ` > :nth-child(${cell.nthChild})`;
      if (cell.collapsed) {
        rules.push(
          `${root.repeat(3)}${child} { flex: 0 0 ${COLLAPSED_PANE_SIZE_PX}px !important; }`,
        );
      } else if (!cell.pinned && total > 0) {
        rules.push(
          `${root}${child} { flex-grow: ${cell.grow / total} !important; }`,
        );
      }
    }
  }
  return rules.join("\n");
}
