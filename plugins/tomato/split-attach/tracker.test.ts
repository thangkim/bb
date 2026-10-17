import type { PluginSidebarSplitLayout } from "@get-bb/plugin-sdk/app";
import { describe, expect, it } from "vitest";
import {
  advanceSplitTracker,
  seedSplitTracker,
  type SplitTrackerState,
} from "./tracker";

function layout(
  ...panes: [paneId: string, threadId: string | null, focused?: boolean][]
): PluginSidebarSplitLayout {
  return {
    panes: panes.map(([paneId, threadId, focused]) => ({
      paneId,
      threadId,
      isFocused: focused === true,
      rect: { x: 0, y: 0, width: 100, height: 100 },
    })),
  };
}

function run(
  steps: [PluginSidebarSplitLayout | null, string | null, number][],
) {
  const [first, ...rest] = steps;
  let state: SplitTrackerState = seedSplitTracker(first![0], first![1]);
  const requests = [];
  for (const [nextLayout, route, now] of rest) {
    const result = advanceSplitTracker(state, nextLayout, route, now);
    state = result.state;
    requests.push(...result.requests);
  }
  return requests;
}

describe("split attach tracker", () => {
  it("links the thread created in a new split pane to the thread it was split from", () => {
    expect(
      run([
        [null, "thr_source", 0],
        [layout(["a", "thr_source"], ["b", null, true]), "thr_source", 1_000],
        [layout(["a", "thr_source"], ["b", null, true]), "thr_source", 2_000],
        [layout(["a", "thr_source"], ["b", "thr_new", true]), "thr_new", 9_000],
        [layout(["a", "thr_source"], ["b", "thr_next", true]), "thr_next", 9_500],
      ]),
    ).toEqual([
      { sourceThreadId: "thr_source", threadId: "thr_new", paneAgeMs: 8_000 },
    ]);
  });

  it("uses the focused thread of an existing split as the source", () => {
    expect(
      run([
        [layout(["a", "thr_one", true], ["b", "thr_two"]), "thr_one", 0],
        [layout(["a", "thr_one"], ["b", "thr_two", true]), "thr_two", 100],
        [
          layout(["a", "thr_one"], ["b", "thr_two"], ["c", null, true]),
          "thr_two",
          200,
        ],
        [
          layout(["a", "thr_one"], ["b", "thr_two"], ["c", "thr_new", true]),
          "thr_new",
          700,
        ],
      ]),
    ).toEqual([
      { sourceThreadId: "thr_two", threadId: "thr_new", paneAgeMs: 500 },
    ]);
  });

  it("ignores panes restored on load, splits from non-thread pages, and closed panes", () => {
    expect(
      run([
        [layout(["a", "thr_one", true], ["b", null]), "thr_one", 0],
        [layout(["a", "thr_one"], ["b", "thr_restored", true]), "thr_restored", 100],
      ]),
    ).toEqual([]);
    expect(
      run([
        [null, null, 0],
        [layout(["a", null], ["b", null, true]), null, 100],
        [layout(["a", null], ["b", "thr_new", true]), "thr_new", 200],
      ]),
    ).toEqual([]);
    expect(
      run([
        [null, "thr_source", 0],
        [layout(["a", "thr_source"], ["b", null, true]), "thr_source", 100],
        [null, "thr_source", 200],
        [layout(["a", "thr_source"], ["c", "thr_new", true]), "thr_new", 300],
      ]),
    ).toEqual([]);
  });
});
