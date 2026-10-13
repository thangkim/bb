import type {
  PluginBrowserBbSdk,
  PluginSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";
import { describe, expect, it, vi } from "vitest";
import {
  advanceSplitTracker,
  copySplitTabs,
  inheritTabs,
  localPanelStateStore,
  parsePanelState,
  seedComposerPanel,
  seedSplitTracker,
  type PanelState,
  type PanelStateStore,
  type SplitCreation,
  type ThreadTab,
} from "./split-tabs";

function layout(
  ...panes: [paneId: string, threadId: string | null, focused?: boolean][]
): PluginSidebarSplitLayout {
  return {
    panes: panes.map(([paneId, threadId, focused]) => ({
      paneId,
      threadId,
      isFocused: focused === true,
      rect: { x: 0, y: 0, width: 1, height: 1 },
    })),
  };
}

function run(
  steps: [PluginSidebarSplitLayout | null, string | null, number][],
): SplitCreation[] {
  const [first, ...rest] = steps;
  let state = seedSplitTracker(first![0], first![1]);
  const created: SplitCreation[] = [];
  for (const [nextLayout, route, now] of rest) {
    const result = advanceSplitTracker(state, nextLayout, route, now);
    state = result.state;
    created.push(...result.created);
  }
  return created;
}

const INFO: ThreadTab = {
  id: "thread-info:thread-info:none",
  kind: "thread-info",
};
const DIFF: ThreadTab = { id: "git-diff:git-diff:none", kind: "git-diff" };
const FILE: ThreadTab = {
  id: "workspace-file-preview:src%2Fa.ts:env_1",
  kind: "workspace-file-preview",
  environmentId: "env_1",
  projectId: "proj_1",
  path: "src/a.ts",
  lineRange: null,
  source: { kind: "working-tree" },
  statusLabel: null,
};
const PANEL: ThreadTab = {
  id: "plugin-panel:tasks%3Atask%3A:none",
  kind: "plugin-panel",
  pluginId: "tasks",
  actionId: "task",
  title: "Task",
  paramsJson: null,
};
const BROWSER: ThreadTab = {
  id: "browser:docs:env_1",
  kind: "browser",
  environmentId: "env_1",
  url: "http://localhost:3000",
  title: "Docs",
  desktopTarget: { hostId: "h", instanceId: "i", generation: "g" },
};
const TERMINAL: ThreadTab = {
  id: "terminal:term_1:none",
  kind: "terminal",
  terminalId: "term_1",
};

describe("split tracker", () => {
  it("reports the thread created in a pane split off the active thread", () => {
    expect(
      run([
        [null, "thr_source", 0],
        [layout(["a", "thr_source"], ["b", null, true]), "thr_source", 1_000],
        [layout(["a", "thr_source"], ["b", "thr_new", true]), "thr_new", 5_000],
        [
          layout(["a", "thr_source"], ["b", "thr_next", true]),
          "thr_next",
          6_000,
        ],
      ]),
    ).toEqual([
      { sourceThreadId: "thr_source", threadId: "thr_new", openedAt: 1_000 },
    ]);
  });

  it("ignores restored panes, splits from non-thread pages, and collapsed splits", () => {
    expect(
      run([
        [layout(["a", "thr_one", true], ["b", null]), "thr_one", 0],
        [
          layout(["a", "thr_one"], ["b", "thr_restored", true]),
          "thr_restored",
          1,
        ],
      ]),
    ).toEqual([]);
    expect(
      run([
        [null, null, 0],
        [layout(["a", null], ["b", null, true]), null, 1],
        [layout(["a", null], ["b", "thr_new", true]), "thr_new", 2],
      ]),
    ).toEqual([]);
    expect(
      run([
        [null, "thr_source", 0],
        [layout(["a", "thr_source"], ["b", null, true]), "thr_source", 1],
        [null, "thr_source", 2],
        [layout(["a", "thr_source"], ["c", "thr_new", true]), "thr_new", 3],
      ]),
    ).toEqual([]);
  });
});

describe("inheritTabs", () => {
  it("puts the source's tabs first, keeps the new thread's own, and drops live or transient ones", () => {
    const { desktopTarget: _desktopTarget, ...browser } = BROWSER as Extract<
      ThreadTab,
      { kind: "browser" }
    >;
    expect(
      inheritTabs(
        [INFO, FILE, TERMINAL, BROWSER, PANEL, { id: "new", kind: "new-tab" }],
        [INFO, DIFF],
        "thr_new",
      ),
    ).toEqual([
      INFO,
      FILE,
      { ...browser, id: "browser:docs%40thr_new:env_1" },
      PANEL,
      DIFF,
    ]);
  });

  it("gives copied browser tabs an id of their own so the two views navigate independently", () => {
    const [copy] = inheritTabs([BROWSER], [], "thr_new")!;
    const [other] = inheritTabs([BROWSER], [], "thr_other")!;
    expect(new Set([BROWSER.id, copy!.id, other!.id]).size).toBe(3);
    expect(inheritTabs([BROWSER], [copy!], "thr_new")).toBeNull();
  });

  it("does nothing when the tabs are already there", () => {
    expect(inheritTabs([INFO, TERMINAL], [INFO], "thr_new")).toBeNull();
    expect(inheritTabs([INFO, FILE], [FILE, INFO], "thr_new")).toBeNull();
  });
});

describe("copySplitTabs", () => {
  function fakeSdk(createdAt: number, conflicts = 0) {
    const tabsByThread = new Map<
      string,
      { revision: number; tabs: ThreadTab[] }
    >([
      ["thr_source", { revision: 4, tabs: [INFO, FILE] }],
      ["thr_new", { revision: 0, tabs: [] }],
    ]);
    let remainingConflicts = conflicts;
    const update = vi.fn(
      async (input: {
        threadId: string;
        expectedRevision: number;
        tabs: ThreadTab[];
      }) => {
        if (remainingConflicts > 0) {
          remainingConflicts -= 1;
          tabsByThread.set(input.threadId, { revision: 1, tabs: [INFO, DIFF] });
          throw new Error("thread_tabs_conflict");
        }
        const next = { revision: input.expectedRevision + 1, tabs: input.tabs };
        tabsByThread.set(input.threadId, next);
        return next;
      },
    );
    const sdk = {
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({
          id: threadId,
          createdAt,
        }),
        tabs: {
          get: async ({ threadId }: { threadId: string }) =>
            tabsByThread.get(threadId)!,
          update,
        },
      },
    } as unknown as PluginBrowserBbSdk;
    return { sdk, update, tabsByThread };
  }

  function fakePanels(initial: Record<string, PanelState> = {}) {
    const states = new Map(Object.entries(initial));
    const store: PanelStateStore = {
      read: (threadId) => states.get(threadId) ?? null,
      write: (threadId, state) => {
        states.set(threadId, state);
      },
    };
    return { store, states };
  }

  const creation: SplitCreation = {
    sourceThreadId: "thr_source",
    threadId: "thr_new",
    openedAt: 100_000,
  };

  it("copies the source's tabs into the new thread, retrying a revision conflict", async () => {
    const { sdk, update, tabsByThread } = fakeSdk(101_000, 1);
    const { store, states } = fakePanels();
    expect(await copySplitTabs(sdk, creation, store, 0)).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);
    expect(tabsByThread.get("thr_new")).toEqual({
      revision: 2,
      tabs: [INFO, FILE, DIFF],
    });
    expect(states.has("thr_new")).toBe(false);
  });

  it("opens the new thread's panel on its own copy of the source's active browser tab at the source's current url", async () => {
    const { sdk, tabsByThread } = fakeSdk(101_000);
    const navigated = { ...BROWSER, url: "http://localhost:3000/settings" };
    const { store, states } = fakePanels({
      thr_source: {
        tabs: [INFO, navigated, TERMINAL],
        activeTabId: BROWSER.id,
        isOpen: true,
      },
    });
    expect(await copySplitTabs(sdk, creation, store, 0)).toBe(true);
    const { desktopTarget: _desktopTarget, ...browser } = navigated;
    const copy = { ...browser, id: "browser:docs%40thr_new:env_1" };
    expect(tabsByThread.get("thr_new")?.tabs).toEqual([INFO, copy]);
    expect(states.get("thr_new")).toEqual({
      tabs: [INFO, copy],
      activeTabId: copy.id,
      isOpen: true,
    });
  });

  it("falls back to the first tab when the source's active tab is not inherited", async () => {
    const { sdk } = fakeSdk(101_000);
    const { store, states } = fakePanels({
      thr_source: {
        tabs: [FILE, TERMINAL],
        activeTabId: TERMINAL.id,
        isOpen: true,
      },
    });
    await copySplitTabs(sdk, creation, store, 0);
    expect(states.get("thr_new")?.activeTabId).toBe(FILE.id);
  });

  it("leaves an existing thread opened in the split pane alone", async () => {
    const { sdk, update } = fakeSdk(10_000);
    const { store, states } = fakePanels({
      thr_source: { tabs: [FILE], activeTabId: FILE.id, isOpen: true },
    });
    expect(await copySplitTabs(sdk, creation, store, 0)).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(states.has("thr_new")).toBe(false);
  });
});

describe("seedComposerPanel", () => {
  it("mirrors the source's panel into the composer, closed when the source's is closed", () => {
    const states = new Map<string, PanelState>([
      [
        "thr_open",
        { tabs: [FILE, TERMINAL], activeTabId: FILE.id, isOpen: true },
      ],
      ["thr_closed", { tabs: [FILE], activeTabId: FILE.id, isOpen: false }],
    ]);
    const store: PanelStateStore = {
      read: (threadId) => states.get(threadId) ?? null,
      write: (threadId, state) => {
        states.set(threadId, state);
      },
    };
    expect(seedComposerPanel(store, "thr_open", 0)).toBe(true);
    expect(states.get("root-compose")).toEqual({
      tabs: [FILE],
      activeTabId: FILE.id,
      isOpen: true,
    });
    seedComposerPanel(store, "thr_closed", 0);
    expect(states.get("root-compose")).toEqual({
      tabs: [FILE],
      activeTabId: null,
      isOpen: false,
    });
    expect(seedComposerPanel(store, "thr_unknown", 0)).toBe(false);
  });
});

describe("local panel state", () => {
  it("reads bb's stored panel state, dropping tabs the server does not keep", () => {
    expect(
      parsePanelState(
        JSON.stringify({
          version: 1,
          secondary: {
            tabs: [INFO, { id: "fixed", kind: "plugin-page-fixed" }, BROWSER],
            activeTabId: BROWSER.id,
            isOpen: true,
          },
          lastUsedAt: 1,
        }),
      ),
    ).toEqual({ tabs: [INFO, BROWSER], activeTabId: BROWSER.id, isOpen: true });
    expect(parsePanelState(null)).toBeNull();
    expect(parsePanelState("{")).toBeNull();
    expect(
      parsePanelState(JSON.stringify({ version: 2, secondary: {} })),
    ).toBeNull();
  });

  it("writes under bb's key and announces the change so the open view picks it up", () => {
    const items = new Map<string, string>();
    const events: { key: string | null; newValue: string | null }[] = [];
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
    } as unknown as Storage;
    class FakeStorageEvent {
      key: string | null;
      newValue: string | null;
      constructor(_type: string, init: StorageEventInit) {
        this.key = init.key ?? null;
        this.newValue = init.newValue ?? null;
      }
    }
    vi.stubGlobal("StorageEvent", FakeStorageEvent);
    try {
      const store = localPanelStateStore({
        localStorage: storage,
        dispatchEvent: (event: FakeStorageEvent) => {
          events.push(event);
          return true;
        },
      } as unknown as Window);
      const state: PanelState = {
        tabs: [FILE],
        activeTabId: FILE.id,
        isOpen: true,
      };
      store.write("thr_new", state, 42);
      const key = "bb.thread.fixedPanelTabsState-thr_new-1";
      expect(JSON.parse(items.get(key)!)).toEqual({
        version: 1,
        secondary: state,
        lastUsedAt: 42,
      });
      expect(events).toEqual([{ key, newValue: items.get(key) }]);
      expect(store.read("thr_new")).toEqual(state);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
