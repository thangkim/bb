export const NAVIGATION_SLOT_ID = "tabs";

export const SIDEBAR_TABS = ["projects", "threads", "more"] as const;

export type SidebarTab = (typeof SIDEBAR_TABS)[number];

export const DEFAULT_TAB: SidebarTab = "threads";

export const PANEL_ATTRIBUTE = "data-sidebar-tab-panel";

export const PANELS_CHANGED_EVENT = "bb:sidebar-tab-panels";

export const EXPANDED_ATTRIBUTE = "data-sidebar-tabs-expanded";

export const NAVIGATION_REGION_SELECTOR =
  '[data-testid="sidebar-navigation-region"]';

const STORAGE_KEY = "bb-plugin-sidebar-tabs:active-tab";

export function parseTab(value: string | null): SidebarTab {
  return SIDEBAR_TABS.find((tab) => tab === value) ?? DEFAULT_TAB;
}

export function adjacentTab(tab: SidebarTab, offset: -1 | 1): SidebarTab {
  const index = SIDEBAR_TABS.indexOf(tab);
  const next = (index + offset + SIDEBAR_TABS.length) % SIDEBAR_TABS.length;
  return SIDEBAR_TABS[next] ?? DEFAULT_TAB;
}

export function expandedRegionCss(): string {
  return [
    `[${EXPANDED_ATTRIBUTE}]{display:flex;flex-direction:column;flex:1 1 0%;min-height:0}`,
    `[${EXPANDED_ATTRIBUTE}] ~ [data-sidebar="content"]{display:none}`,
  ].join("\n");
}

export interface TabStore {
  get: () => SidebarTab;
  set: (tab: SidebarTab) => void;
  subscribe: (listener: () => void) => () => void;
}

function readStoredTab(): SidebarTab {
  try {
    return parseTab(globalThis.localStorage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return DEFAULT_TAB;
  }
}

function writeStoredTab(tab: SidebarTab): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, tab);
  } catch {
    return;
  }
}

export function createTabStore(): TabStore {
  let current: SidebarTab | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => (current ??= readStoredTab()),
    set: (tab) => {
      if (tab === current) return;
      current = tab;
      writeStoredTab(tab);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
