import type {
  PluginBrowserBbSdk,
  PluginSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";

type ThreadTabs = PluginBrowserBbSdk["threads"]["tabs"];
export type ThreadTab = Awaited<ReturnType<ThreadTabs["get"]>>["tabs"][number];

export const NEW_THREAD_CLOCK_TOLERANCE_MS = 10_000;
const WRITE_ATTEMPTS = 3;
const PANEL_STATE_KEY_PREFIX = "bb.thread.fixedPanelTabsState";
const PANEL_STATE_VERSION = 1;
export const COMPOSER_PANEL_STATE_ID = "root-compose";
const SERVER_TAB_KINDS: ReadonlySet<string> = new Set<ThreadTab["kind"]>([
  "thread-info",
  "git-diff",
  "plugin-panel",
  "workspace-file-preview",
  "host-file-preview",
  "thread-storage-file-preview",
  "attachment-file-preview",
  "browser",
  "new-tab",
  "side-chat",
  "terminal",
]);

export interface PanelState {
  tabs: ThreadTab[];
  activeTabId: string | null;
  isOpen: boolean;
}

export interface PanelStateStore {
  read(threadId: string): PanelState | null;
  write(threadId: string, state: PanelState, now: number): void;
}

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
  const inheritedIds = new Set(inherited.map((tab) => tab.id));
  const targetIds = new Set(targetTabs.map((tab) => tab.id));
  if ([...inheritedIds].every((id) => targetIds.has(id))) return null;
  return [
    ...inherited,
    ...targetTabs.filter((tab) => !inheritedIds.has(tab.id)),
  ];
}

export function inheritActiveTabId(
  source: PanelState,
  tabs: readonly ThreadTab[],
  targetThreadId: string,
): string | null {
  const active = source.tabs.find((tab) => tab.id === source.activeTabId);
  const inheritedId =
    active === undefined
      ? undefined
      : inheritableTab(active, targetThreadId)[0]?.id;
  if (inheritedId !== undefined && tabs.some((tab) => tab.id === inheritedId)) {
    return inheritedId;
  }
  return tabs[0]?.id ?? null;
}

function panelStateKey(threadId: string): string {
  return `${PANEL_STATE_KEY_PREFIX}-${encodeURIComponent(threadId.trim())}-${PANEL_STATE_VERSION}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parsePanelState(raw: string | null): PanelState | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== PANEL_STATE_VERSION) return null;
  const secondary = parsed.secondary;
  if (
    !isRecord(secondary) ||
    !Array.isArray(secondary.tabs) ||
    typeof secondary.isOpen !== "boolean"
  ) {
    return null;
  }
  const tabs = secondary.tabs.filter(
    (tab): tab is ThreadTab =>
      isRecord(tab) &&
      typeof tab.id === "string" &&
      typeof tab.kind === "string" &&
      SERVER_TAB_KINDS.has(tab.kind),
  );
  return {
    tabs,
    activeTabId:
      typeof secondary.activeTabId === "string" ? secondary.activeTabId : null,
    isOpen: secondary.isOpen,
  };
}

export function localPanelStateStore(window: Window): PanelStateStore {
  const storage = window.localStorage;
  return {
    read: (threadId) =>
      parsePanelState(storage.getItem(panelStateKey(threadId))),
    write: (threadId, state, now) => {
      const key = panelStateKey(threadId);
      const oldValue = storage.getItem(key);
      const newValue = JSON.stringify({
        version: PANEL_STATE_VERSION,
        secondary: state,
        lastUsedAt: now,
      });
      storage.setItem(key, newValue);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          oldValue,
          newValue,
          storageArea: storage,
        }),
      );
    },
  };
}

async function writeServerTabs(
  sdk: PluginBrowserBbSdk,
  creation: SplitCreation,
  sourceTabs: readonly ThreadTab[],
): Promise<ThreadTab[]> {
  for (let attempt = 1; ; attempt++) {
    const target = await sdk.threads.tabs.get({ threadId: creation.threadId });
    const tabs = inheritTabs(sourceTabs, target.tabs, creation.threadId);
    if (tabs === null) return target.tabs;
    try {
      await sdk.threads.tabs.update({
        threadId: creation.threadId,
        expectedRevision: target.revision,
        tabs,
      });
      return tabs;
    } catch (error) {
      if (attempt >= WRITE_ATTEMPTS) throw error;
    }
  }
}

export function seedComposerPanel(
  panels: PanelStateStore,
  sourceThreadId: string,
  now: number,
): boolean {
  const source = panels.read(sourceThreadId);
  if (source === null) return false;
  const tabs = source.tabs.flatMap((tab) =>
    inheritableTab(tab, COMPOSER_PANEL_STATE_ID),
  );
  const isOpen = source.isOpen && tabs.length > 0;
  panels.write(
    COMPOSER_PANEL_STATE_ID,
    {
      tabs,
      activeTabId: isOpen
        ? inheritActiveTabId(source, tabs, COMPOSER_PANEL_STATE_ID)
        : null,
      isOpen,
    },
    now,
  );
  return true;
}

export async function copySplitTabs(
  sdk: PluginBrowserBbSdk,
  creation: SplitCreation,
  panels: PanelStateStore,
  now: number,
): Promise<boolean> {
  const [thread, serverSource] = await Promise.all([
    sdk.threads.get({ threadId: creation.threadId }),
    sdk.threads.tabs.get({ threadId: creation.sourceThreadId }),
  ]);
  if (thread.createdAt < creation.openedAt - NEW_THREAD_CLOCK_TOLERANCE_MS) {
    return false;
  }
  const source = panels.read(creation.sourceThreadId) ?? {
    tabs: serverSource.tabs,
    activeTabId: null,
    isOpen: false,
  };
  const tabs = await writeServerTabs(sdk, creation, source.tabs);
  if (source.isOpen && tabs.length > 0) {
    panels.write(
      creation.threadId,
      {
        tabs,
        activeTabId: inheritActiveTabId(source, tabs, creation.threadId),
        isOpen: true,
      },
      now,
    );
  }
  return true;
}
