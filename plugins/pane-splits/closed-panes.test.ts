import { describe, expect, it } from "vitest";
import type { PluginSidebarSplitLayout } from "@get-bb/plugin-sdk/app";
import {
  CLOSED_PANE_HISTORY_LIMIT,
  closedPaneRecords,
  nextReopenTarget,
  recordClosedPanes,
  type ClosedPaneRecord,
} from "./closed-panes";

type Pane = PluginSidebarSplitLayout["panes"][number];

function pane(
  paneId: string,
  threadId: string | null,
  x: number,
  y: number,
  width: number,
  height: number,
): Pane {
  return { paneId, threadId, rect: { x, y, width, height }, isFocused: false };
}

function layout(...panes: Pane[]): PluginSidebarSplitLayout {
  return { panes };
}

describe("closedPaneRecords", () => {
  it("records both panes of a collapsed two-pane split, each placed against the other", () => {
    const previous = layout(
      pane("p1", "a", 0, 0, 0.5, 1),
      pane("p2", "b", 0.5, 0, 0.5, 1),
    );

    expect(closedPaneRecords(previous, null)).toEqual([
      [
        { threadId: "a", side: "left" },
        { threadId: "b", side: "right" },
      ],
    ]);
  });

  it("places a removed pane against the pane that took over its space", () => {
    const previous = layout(
      pane("p1", "a", 0, 0, 0.5, 1),
      pane("p2", "b", 0.5, 0, 0.5, 0.5),
      pane("p3", "c", 0.5, 0.5, 0.5, 0.5),
    );
    const next = layout(
      pane("p1", "a", 0, 0, 0.5, 1),
      pane("p2", "b", 0.5, 0, 0.5, 1),
    );

    expect(closedPaneRecords(previous, next)).toEqual([
      [{ threadId: "c", side: "bottom" }],
    ]);
  });

  it("places a pane closed above its survivor on top", () => {
    const previous = layout(
      pane("p1", "a", 0, 0, 1, 0.5),
      pane("p2", "b", 0, 0.5, 0.5, 0.5),
      pane("p3", "c", 0.5, 0.5, 0.5, 0.5),
    );
    const next = layout(
      pane("p2", "b", 0, 0, 0.5, 1),
      pane("p3", "c", 0.5, 0, 0.5, 1),
    );

    expect(closedPaneRecords(previous, next)).toEqual([
      [{ threadId: "a", side: "top" }],
    ]);
  });

  it("ignores panes that did not hold a thread", () => {
    const previous = layout(
      pane("p1", "a", 0, 0, 0.5, 1),
      pane("p2", null, 0.5, 0, 0.5, 1),
    );

    expect(closedPaneRecords(previous, null)).toEqual([
      [{ threadId: "a", side: "left" }],
    ]);
    expect(
      closedPaneRecords(
        layout(
          pane("p1", null, 0, 0, 0.5, 1),
          pane("p2", null, 0.5, 0, 0.5, 1),
        ),
        null,
      ),
    ).toEqual([]);
  });

  it("ignores navigation inside a pane and layouts that vanish with more than two panes", () => {
    const previous = layout(
      pane("p1", "a", 0, 0, 0.5, 1),
      pane("p2", "b", 0.5, 0, 0.5, 0.5),
      pane("p3", "c", 0.5, 0.5, 0.5, 0.5),
    );
    const navigated = layout(
      pane("p1", "z", 0, 0, 0.5, 1),
      pane("p2", "b", 0.5, 0, 0.5, 0.5),
      pane("p3", "c", 0.5, 0.5, 0.5, 0.5),
    );

    expect(closedPaneRecords(previous, navigated)).toEqual([]);
    expect(closedPaneRecords(previous, null)).toEqual([]);
    expect(closedPaneRecords(null, previous)).toEqual([]);
  });
});

describe("recordClosedPanes", () => {
  it(`keeps the newest ${CLOSED_PANE_HISTORY_LIMIT} closes`, () => {
    let history: readonly ClosedPaneRecord[] = [];
    for (let index = 0; index < CLOSED_PANE_HISTORY_LIMIT + 5; index += 1) {
      history = recordClosedPanes(
        history,
        layout(
          pane("p1", "keep", 0, 0, 0.5, 1),
          pane("p2", `t${index}`, 0.5, 0, 0.5, 1),
        ),
        null,
      );
    }

    expect(history).toHaveLength(CLOSED_PANE_HISTORY_LIMIT);
    expect(history.at(-1)?.[1]?.threadId).toBe(
      `t${CLOSED_PANE_HISTORY_LIMIT + 4}`,
    );
  });
});

describe("nextReopenTarget", () => {
  it("reopens the most recent closed thread that is not open, dropping stale records", () => {
    const history: ClosedPaneRecord[] = [
      [{ threadId: "older", side: "left" }],
      [{ threadId: "reopened-already", side: "right" }],
      [
        { threadId: "still-open", side: "left" },
        { threadId: "closed", side: "right" },
      ],
    ];

    const first = nextReopenTarget(history, new Set(["still-open"]));
    expect(first.target).toEqual({ threadId: "closed", side: "right" });

    const second = nextReopenTarget(
      first.history,
      new Set(["reopened-already", "closed"]),
    );
    expect(second.target).toEqual({ threadId: "older", side: "left" });
    expect(second.history).toEqual([]);
  });

  it("reports nothing to reopen once every record is open", () => {
    expect(
      nextReopenTarget([[{ threadId: "a", side: "left" }]], new Set(["a"])),
    ).toEqual({ target: null, history: [] });
  });
});
