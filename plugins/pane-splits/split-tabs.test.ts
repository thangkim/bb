import type {
  PluginBrowserBbSdk,
  PluginSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";
import { describe, expect, it, vi } from "vitest";
import {
  advanceSplitTracker,
  copySplitTabs,
  inheritTabs,
  seedSplitTracker,
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

const INFO: ThreadTab = { id: "thread-info:thread-info:none", kind: "thread-info" };
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
        [layout(["a", "thr_source"], ["b", "thr_next", true]), "thr_next", 6_000],
      ]),
    ).toEqual([
      { sourceThreadId: "thr_source", threadId: "thr_new", openedAt: 1_000 },
    ]);
  });

  it("ignores restored panes, splits from non-thread pages, and collapsed splits", () => {
    expect(
      run([
        [layout(["a", "thr_one", true], ["b", null]), "thr_one", 0],
        [layout(["a", "thr_one"], ["b", "thr_restored", true]), "thr_restored", 1],
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
      ),
    ).toEqual([INFO, FILE, browser, PANEL, DIFF]);
  });

  it("does nothing when the source only has fixed tabs or the tabs are already there", () => {
    expect(inheritTabs([INFO, DIFF, TERMINAL], [INFO])).toBeNull();
    expect(inheritTabs([INFO, FILE], [FILE, INFO])).toBeNull();
  });
});

describe("copySplitTabs", () => {
  function fakeSdk(createdAt: number, conflicts = 0) {
    const tabsByThread = new Map<string, { revision: number; tabs: ThreadTab[] }>([
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

  const creation: SplitCreation = {
    sourceThreadId: "thr_source",
    threadId: "thr_new",
    openedAt: 100_000,
  };

  it("copies the source's tabs into the new thread, retrying a revision conflict", async () => {
    const { sdk, update, tabsByThread } = fakeSdk(101_000, 1);
    expect(await copySplitTabs(sdk, creation)).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);
    expect(tabsByThread.get("thr_new")).toEqual({
      revision: 2,
      tabs: [INFO, FILE, DIFF],
    });
  });

  it("leaves an existing thread opened in the split pane alone", async () => {
    const { sdk, update } = fakeSdk(10_000);
    expect(await copySplitTabs(sdk, creation)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
