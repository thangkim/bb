import type { PluginSidebarSplitLayout } from "@get-bb/plugin-sdk/app";

type Pane = PluginSidebarSplitLayout["panes"][number];

export type CollapsedPanes = ReadonlySet<string>;

export const COLLAPSED_PANE_SIZE_PX = 36;
export const PANE_SELECTOR = "[data-split-pane-id]";
export const STRIP_ATTRIBUTE = "data-pane-collapse-strip";

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

function attributeValue(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

export function collapsedPaneCss(collapsed: CollapsedPanes): string {
  return [...collapsed]
    .map((paneId) => {
      const pane = `[data-split-pane-id="${attributeValue(paneId)}"]`;
      return [
        `[data-split-resize-grid-root] > div:has(> ${pane}) { flex: 0 0 ${COLLAPSED_PANE_SIZE_PX}px !important; }`,
        `${pane}[data-maximized] > [${STRIP_ATTRIBUTE}] { display: none !important; }`,
      ].join("\n");
    })
    .join("\n");
}
