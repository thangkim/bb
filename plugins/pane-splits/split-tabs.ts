import type {
  PluginBrowserBbSdk,
  PluginSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";

type ThreadTabs = PluginBrowserBbSdk["threads"]["tabs"];
export type ThreadTab = Awaited<ReturnType<ThreadTabs["get"]>>["tabs"][number];

export const NEW_THREAD_CLOCK_TOLERANCE_MS = 10_000;
const WRITE_ATTEMPTS = 3;

interface PendingSplit {
  sourceThreadId: string;
  openedAt: number;
}

export interface SplitTrackerState {
  activeThreadId: string | null;
  panes: ReadonlyMap<string, PendingSplit | null>;
}

export interface SplitCreation {
  sourceThreadId: string;
  threadId: string;
  openedAt: number;
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
): { state: SplitTrackerState; created: SplitCreation[] } {
  if (layout === null) {
    return { state: seedSplitTracker(null, routeThreadId), created: [] };
  }
  const focusedThreadId =
    layout.panes.find((pane) => pane.isFocused)?.threadId ?? null;
  const activeThreadId = focusedThreadId ?? state.activeThreadId;
  const panes = new Map<string, PendingSplit | null>();
  const created: SplitCreation[] = [];
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
      created.push({ ...pending, threadId: pane.threadId });
    }
    panes.set(pane.paneId, null);
  }
  return { state: { activeThreadId, panes }, created };
}

function browserTabIdForThread(
  tab: Extract<ThreadTab, { kind: "browser" }>,
  threadId: string,
): string {
  const segments = tab.id.split(":");
  const path =
    segments.length === 3 && segments[0] === "browser"
      ? decodeURIComponent(segments[1] ?? "")
      : tab.id;
  return [
    "browser",
    encodeURIComponent(`${path}@${threadId}`),
    encodeURIComponent(tab.environmentId ?? "none"),
  ].join(":");
}

function inheritableTab(tab: ThreadTab, threadId: string): ThreadTab[] {
  switch (tab.kind) {
    case "new-tab":
    case "side-chat":
    case "terminal":
      return [];
    case "thread-storage-file-preview":
      return tab.threadId === null ? [] : [tab];
    case "browser": {
      const { desktopTarget: _desktopTarget, ...rest } = tab;
      return [{ ...rest, id: browserTabIdForThread(tab, threadId) }];
    }
    default:
      return [tab];
  }
}

export function inheritTabs(
  sourceTabs: readonly ThreadTab[],
  targetTabs: readonly ThreadTab[],
  targetThreadId: string,
): ThreadTab[] | null {
  const inherited = sourceTabs.flatMap((tab) =>
    inheritableTab(tab, targetThreadId),
  );
  if (
    inherited.every(
      (tab) => tab.kind === "thread-info" || tab.kind === "git-diff",
    )
  ) {
    return null;
  }
  const inheritedIds = new Set(inherited.map((tab) => tab.id));
  const targetIds = new Set(targetTabs.map((tab) => tab.id));
  if ([...inheritedIds].every((id) => targetIds.has(id))) return null;
  return [
    ...inherited,
    ...targetTabs.filter((tab) => !inheritedIds.has(tab.id)),
  ];
}

export async function copySplitTabs(
  sdk: PluginBrowserBbSdk,
  creation: SplitCreation,
): Promise<boolean> {
  const [thread, source] = await Promise.all([
    sdk.threads.get({ threadId: creation.threadId }),
    sdk.threads.tabs.get({ threadId: creation.sourceThreadId }),
  ]);
  if (thread.createdAt < creation.openedAt - NEW_THREAD_CLOCK_TOLERANCE_MS) {
    return false;
  }
  for (let attempt = 1; ; attempt++) {
    const target = await sdk.threads.tabs.get({ threadId: creation.threadId });
    const tabs = inheritTabs(source.tabs, target.tabs, creation.threadId);
    if (tabs === null) return false;
    try {
      await sdk.threads.tabs.update({
        threadId: creation.threadId,
        expectedRevision: target.revision,
        tabs,
      });
      return true;
    } catch (error) {
      if (attempt >= WRITE_ATTEMPTS) throw error;
    }
  }
}
