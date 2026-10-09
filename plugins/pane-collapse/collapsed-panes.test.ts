import { describe, expect, it } from "vitest";
import type { PluginSidebarSplitLayout } from "@get-bb/plugin-sdk/app";
import {
  canCollapse,
  collapsedPaneCss,
  focusTargetAfterCollapse,
  newlyFocusedCollapsedPane,
  pruneCollapsed,
  withPane,
  withoutPane,
} from "./collapsed-panes";

function layout(
  panes: [paneId: string, threadId: string | null, x: number][],
  focused = panes[0]?.[0],
): PluginSidebarSplitLayout {
  const width = 1 / panes.length;
  return {
    panes: panes.map(([paneId, threadId, x]) => ({
      paneId,
      threadId,
      rect: { x, y: 0, width, height: 1 },
      isFocused: paneId === focused,
    })),
  };
}

const three = layout([
  ["a", "t-a", 0],
  ["b", "t-b", 1 / 3],
  ["c", "t-c", 2 / 3],
]);

describe("canCollapse", () => {
  it("refuses without a split, for unknown panes, and for collapsed ones", () => {
    expect(canCollapse(null, new Set(), "a")).toBe(false);
    expect(canCollapse(three, new Set(), "z")).toBe(false);
    expect(canCollapse(three, new Set(["a"]), "a")).toBe(false);
  });

  it("keeps at least one pane expanded", () => {
    expect(canCollapse(three, new Set(["b"]), "a")).toBe(true);
    expect(canCollapse(three, new Set(["b", "c"]), "a")).toBe(false);
  });
});

describe("focusTargetAfterCollapse", () => {
  it("moves focus to the nearest expanded thread pane", () => {
    expect(focusTargetAfterCollapse(three, new Set(), "a")).toBe("t-b");
    expect(focusTargetAfterCollapse(three, new Set(["b"]), "a")).toBe("t-c");
  });

  it("skips panes that show no thread", () => {
    const withComposer = layout([
      ["a", "t-a", 0],
      ["b", null, 1 / 3],
      ["c", "t-c", 2 / 3],
    ]);
    expect(focusTargetAfterCollapse(withComposer, new Set(), "a")).toBe("t-c");
    expect(
      focusTargetAfterCollapse(withComposer, new Set(["c"]), "a"),
    ).toBeNull();
  });
});

describe("pruneCollapsed", () => {
  it("drops panes that left the layout and keeps identity otherwise", () => {
    const collapsed = new Set(["a", "gone"]);
    expect([...pruneCollapsed(collapsed, three)]).toEqual(["a"]);
    const kept = new Set(["a"]);
    expect(pruneCollapsed(kept, three)).toBe(kept);
    expect(pruneCollapsed(kept, null).size).toBe(0);
  });
});

describe("newlyFocusedCollapsedPane", () => {
  it("expands a collapsed pane only when focus moves onto it", () => {
    const focusedOnB = layout(
      [
        ["a", "t-a", 0],
        ["b", "t-b", 0.5],
      ],
      "b",
    );
    expect(newlyFocusedCollapsedPane("a", focusedOnB, new Set(["b"]))).toEqual(
      { focusedPaneId: "b", expand: "b" },
    );
    expect(newlyFocusedCollapsedPane("b", focusedOnB, new Set(["b"]))).toEqual(
      { focusedPaneId: "b", expand: null },
    );
    expect(newlyFocusedCollapsedPane("a", focusedOnB, new Set())).toEqual({
      focusedPaneId: "b",
      expand: null,
    });
  });
});

describe("set helpers", () => {
  it("return the same set when nothing changes", () => {
    const collapsed = new Set(["a"]);
    expect(withPane(collapsed, "a")).toBe(collapsed);
    expect(withoutPane(collapsed, "b")).toBe(collapsed);
    expect([...withPane(collapsed, "b")]).toEqual(["a", "b"]);
    expect(withoutPane(collapsed, "a").size).toBe(0);
  });
});

describe("collapsedPaneCss", () => {
  it("pins each collapsed pane's split cell to a strip and escapes ids", () => {
    const css = collapsedPaneCss(new Set(['pa"ne']));
    expect(css).toContain(
      '[data-split-resize-grid-root] > div:has(> [data-split-pane-id="pa\\"ne"]) { flex: 0 0 36px !important; }',
    );
    expect(collapsedPaneCss(new Set())).toBe("");
  });
});
