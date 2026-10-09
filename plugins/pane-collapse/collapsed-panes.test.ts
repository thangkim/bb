import { describe, expect, it } from "vitest";
import type { PluginSidebarSplitLayout } from "@get-bb/plugin-sdk/app";
import {
  canCollapse,
  collapsedLayoutCss,
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
    expect(newlyFocusedCollapsedPane("a", focusedOnB, new Set(["b"]))).toEqual({
      focusedPaneId: "b",
      expand: "b",
    });
    expect(newlyFocusedCollapsedPane("b", focusedOnB, new Set(["b"]))).toEqual({
      focusedPaneId: "b",
      expand: null,
    });
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

const ROOT = '[data-pane-collapse-root="0"]';

describe("collapsedLayoutCss", () => {
  it("pins collapsed cells to a strip and scales the rest to fill the grid", () => {
    const css = collapsedLayoutCss([
      {
        rootId: "0",
        cells: [
          { nthChild: 1, grow: 0.2, pinned: false, collapsed: false },
          { nthChild: 3, grow: 0.2, pinned: false, collapsed: true },
          { nthChild: 5, grow: 0.2, pinned: false, collapsed: true },
          { nthChild: 7, grow: 0.4, pinned: false, collapsed: false },
        ],
      },
    ]);
    expect(css).toContain(
      `${ROOT.repeat(3)} > :nth-child(3) { flex: 0 0 36px !important; }`,
    );
    expect(css).toContain(
      `${ROOT.repeat(3)} > :nth-child(5) { flex: 0 0 36px !important; }`,
    );
    expect(css).toMatch(
      /\[data-pane-collapse-root="0"\] > :nth-child\(1\) \{ flex-grow: 0\.333\d* !important; \}/,
    );
    expect(css).toMatch(
      /\[data-pane-collapse-root="0"\] > :nth-child\(7\) \{ flex-grow: 0\.666\d* !important; \}/,
    );
  });

  it("leaves cells another stylesheet pins alone and fills around them", () => {
    const css = collapsedLayoutCss([
      {
        rootId: "0",
        cells: [
          { nthChild: 1, grow: 0.19, pinned: true, collapsed: false },
          { nthChild: 3, grow: 0.2, pinned: false, collapsed: true },
          { nthChild: 5, grow: 0.25, pinned: false, collapsed: false },
          { nthChild: 7, grow: 0.75, pinned: false, collapsed: false },
        ],
      },
    ]);
    expect(css).not.toContain(":nth-child(1)");
    expect(css).toContain(
      `${ROOT} > :nth-child(5) { flex-grow: 0.25 !important; }`,
    );
    expect(css).toContain(
      `${ROOT} > :nth-child(7) { flex-grow: 0.75 !important; }`,
    );
  });
});
