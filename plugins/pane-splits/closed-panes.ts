import type {
  ExperimentalSplitPaneNewThreadOptions,
  PluginSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";

type Side = ExperimentalSplitPaneNewThreadOptions["side"];
type Pane = PluginSidebarSplitLayout["panes"][number];
type Rect = Pane["rect"];

export interface ClosedPane {
  threadId: string;
  side: Side;
}

export type ClosedPaneRecord = readonly ClosedPane[];

export const CLOSED_PANE_HISTORY_LIMIT = 20;

const EDGE_TOLERANCE = 0.001;

export function sideOf(rect: Rect, anchor: Rect): Side {
  if (rect.x >= anchor.x + anchor.width - EDGE_TOLERANCE) return "right";
  if (rect.x + rect.width <= anchor.x + EDGE_TOLERANCE) return "left";
  if (rect.y + rect.height <= anchor.y + EDGE_TOLERANCE) return "top";
  return "bottom";
}

function containsCenter(outer: Rect, inner: Rect): boolean {
  const x = inner.x + inner.width / 2;
  const y = inner.y + inner.height / 2;
  return (
    x >= outer.x &&
    x <= outer.x + outer.width &&
    y >= outer.y &&
    y <= outer.y + outer.height
  );
}

function closedPane(pane: Pane, anchor: Rect): ClosedPane[] {
  return pane.threadId === null
    ? []
    : [{ threadId: pane.threadId, side: sideOf(pane.rect, anchor) }];
}

export function closedPaneRecords(
  previous: PluginSidebarSplitLayout | null,
  next: PluginSidebarSplitLayout | null,
): ClosedPaneRecord[] {
  if (previous === null) return [];
  if (next === null) {
    if (previous.panes.length !== 2) return [];
    const [first, second] = previous.panes as [Pane, Pane];
    const record = [
      ...closedPane(first, second.rect),
      ...closedPane(second, first.rect),
    ];
    return record.length === 0 ? [] : [record];
  }
  if (next.panes.length >= previous.panes.length) return [];
  const nextIds = new Set(next.panes.map((pane) => pane.paneId));
  const previousRects = new Map(
    previous.panes.map((pane) => [pane.paneId, pane.rect]),
  );
  return previous.panes
    .filter((pane) => !nextIds.has(pane.paneId))
    .flatMap((removed) => {
      const survivor = next.panes.find((pane) =>
        containsCenter(pane.rect, removed.rect),
      );
      const anchor =
        survivor === undefined
          ? undefined
          : (previousRects.get(survivor.paneId) ?? survivor.rect);
      if (anchor === undefined) return [];
      const record = closedPane(removed, anchor);
      return record.length === 0 ? [] : [record];
    });
}

export function recordClosedPanes(
  history: readonly ClosedPaneRecord[],
  previous: PluginSidebarSplitLayout | null,
  next: PluginSidebarSplitLayout | null,
): readonly ClosedPaneRecord[] {
  const records = closedPaneRecords(previous, next);
  if (records.length === 0) return history;
  return [...history, ...records].slice(-CLOSED_PANE_HISTORY_LIMIT);
}

export function nextReopenTarget(
  history: readonly ClosedPaneRecord[],
  openThreadIds: ReadonlySet<string>,
): { target: ClosedPane | null; history: readonly ClosedPaneRecord[] } {
  const remaining = [...history];
  for (let record = remaining.pop(); record; record = remaining.pop()) {
    const target = record.find((pane) => !openThreadIds.has(pane.threadId));
    if (target !== undefined) return { target, history: remaining };
  }
  return { target: null, history: [] };
}
