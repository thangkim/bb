import type { PluginSidebarSplitLayout } from "@get-bb/plugin-sdk/app";

interface PendingSplit {
  sourceThreadId: string;
  openedAt: number;
}

export interface SplitTrackerState {
  activeThreadId: string | null;
  panes: ReadonlyMap<string, PendingSplit | null>;
}

export interface SplitAttachRequest {
  sourceThreadId: string;
  threadId: string;
  paneAgeMs: number;
}

export function seedSplitTracker(
  layout: PluginSidebarSplitLayout | null,
  routeThreadId: string | null,
): SplitTrackerState {
  if (layout === null) {
    return { activeThreadId: routeThreadId, panes: new Map() };
  }
  return {
    activeThreadId:
      layout.panes.find((pane) => pane.isFocused)?.threadId ?? null,
    panes: new Map(layout.panes.map((pane) => [pane.paneId, null])),
  };
}

export function advanceSplitTracker(
  state: SplitTrackerState,
  layout: PluginSidebarSplitLayout | null,
  routeThreadId: string | null,
  now: number,
): { state: SplitTrackerState; requests: SplitAttachRequest[] } {
  if (layout === null) {
    return { state: seedSplitTracker(null, routeThreadId), requests: [] };
  }
  const focusedThreadId =
    layout.panes.find((pane) => pane.isFocused)?.threadId ?? null;
  const activeThreadId = focusedThreadId ?? state.activeThreadId;
  const panes = new Map<string, PendingSplit | null>();
  const requests: SplitAttachRequest[] = [];
  for (const pane of layout.panes) {
    if (!state.panes.has(pane.paneId)) {
      panes.set(
        pane.paneId,
        pane.threadId === null && activeThreadId !== null
          ? { sourceThreadId: activeThreadId, openedAt: now }
          : null,
      );
      continue;
    }
    const pending = state.panes.get(pane.paneId) ?? null;
    if (pending === null || pane.threadId === null) {
      panes.set(pane.paneId, pending);
      continue;
    }
    if (pane.threadId !== pending.sourceThreadId) {
      requests.push({
        sourceThreadId: pending.sourceThreadId,
        threadId: pane.threadId,
        paneAgeMs: Math.max(0, now - pending.openedAt),
      });
    }
    panes.set(pane.paneId, null);
  }
  return { state: { activeThreadId, panes }, requests };
}
