import { describe, expect, it } from "vitest";
import type { PluginSidebarSplitLayout } from "@get-bb/plugin-sdk/app";
import { resolveActiveThreadId } from "./active-thread.js";

function layout(
  panes: { threadId: string | null; isFocused: boolean }[],
): PluginSidebarSplitLayout {
  return {
    panes: panes.map((pane, index) => ({
      paneId: `pane_${index}`,
      rect: { x: index / panes.length, y: 0, width: 1 / panes.length, height: 1 },
      ...pane,
    })),
  };
}

describe("active thread", () => {
  it("uses the route thread when nothing is split", () => {
    expect(resolveActiveThreadId(null, "thr_route", "thr_old")).toBe(
      "thr_route",
    );
  });

  it("follows the focused thread pane", () => {
    const split = layout([
      { threadId: null, isFocused: false },
      { threadId: "thr_a", isFocused: false },
      { threadId: "thr_b", isFocused: true },
    ]);
    expect(resolveActiveThreadId(split, null, "thr_a")).toBe("thr_b");
  });

  it("keeps the last focused thread while the tasks pane has focus", () => {
    const split = layout([
      { threadId: null, isFocused: true },
      { threadId: "thr_a", isFocused: false },
      { threadId: "thr_b", isFocused: false },
    ]);
    expect(resolveActiveThreadId(split, null, "thr_a")).toBe("thr_a");
  });

  it("drops a last focused thread that is no longer open in any pane", () => {
    const split = layout([
      { threadId: null, isFocused: true },
      { threadId: "thr_a", isFocused: false },
      { threadId: "thr_b", isFocused: false },
    ]);
    expect(resolveActiveThreadId(split, null, "thr_gone")).toBeNull();
  });

  it("falls back to the only open thread pane", () => {
    const split = layout([
      { threadId: null, isFocused: true },
      { threadId: "thr_a", isFocused: false },
    ]);
    expect(resolveActiveThreadId(split, null, null)).toBe("thr_a");
  });
});
