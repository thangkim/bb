// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { buildThreadTextIndex } from "./thread-find-index";
import {
  collectThreadFindMatches,
  firstMatchAtOrBelowViewTop,
  indexMatchesMountedRows,
  positionMountedRows,
  resolveAnchoredIndex,
  type ObservedRowMatches,
  type ThreadFindMatch,
} from "./thread-find-results";

const index = buildThreadTextIndex(
  [
    { id: "a", kind: "conversation", text: "needle one" },
    { id: "w", kind: "work" },
    { id: "b", kind: "conversation", text: "needle and needle" },
    { id: "c", kind: "conversation", text: "nothing" },
    { id: "d", kind: "conversation", text: "last needle" },
  ].map((row) => row as never),
);

function domRange(text: string): Range {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  document.body.append(paragraph);
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  return range;
}

function describeMatches(matches: readonly ThreadFindMatch[]): string[] {
  return matches.map(
    (match) => `${match.kind}:${match.rowId}:${match.occurrence}`,
  );
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("collectThreadFindMatches", () => {
  it("interleaves unmounted rows from thread data with mounted DOM matches", () => {
    const range = domRange("needle");
    const observed = new Map<string, ObservedRowMatches>();

    const matches = collectThreadFindMatches({
      ranges: [range],
      rowOfRange: () => ({ id: "c", position: 3 }),
      mountedRows: [{ id: "c", position: 3 }],
      index,
      query: "needle",
      observed,
    });

    expect(describeMatches(matches)).toEqual([
      "row:a:0",
      "row:b:0",
      "row:b:1",
      "dom:c:0",
      "row:d:0",
    ]);
    expect(observed.get("c")).toEqual({ count: 1, position: 3 });
  });

  it("remembers rendered counts for rows that scrolled out of the window", () => {
    const observed = new Map<string, ObservedRowMatches>([
      ["b", { count: 0, position: 2 }],
      ["w", { count: 2, position: 1 }],
    ]);

    const matches = collectThreadFindMatches({
      ranges: [],
      rowOfRange: () => null,
      mountedRows: [],
      index,
      query: "needle",
      observed,
    });

    expect(describeMatches(matches)).toEqual([
      "row:a:0",
      "row:w:0",
      "row:w:1",
      "row:d:0",
    ]);
  });

  it("returns DOM matches alone without thread data", () => {
    const matches = collectThreadFindMatches({
      ranges: [domRange("needle"), domRange("needle")],
      rowOfRange: () => null,
      mountedRows: [],
      index: null,
      query: "needle",
      observed: new Map(),
    });

    expect(describeMatches(matches)).toEqual(["dom:null:0", "dom:null:1"]);
  });
});

describe("positionMountedRows", () => {
  it("keeps rows missing from the data right after their predecessor", () => {
    expect(positionMountedRows(["b", "new", "d"], index)).toEqual([
      2, 2.001, 4,
    ]);
    expect(positionMountedRows(["x", "y"], null)).toEqual([0, 1]);
  });

  it("rejects data from another thread", () => {
    expect(indexMatchesMountedRows(["x", "y"], index)).toBe(false);
    expect(indexMatchesMountedRows(["x", "b"], index)).toBe(true);
    expect(indexMatchesMountedRows([], index)).toBe(true);
  });
});

describe("resolveAnchoredIndex", () => {
  const matches: ThreadFindMatch[] = [
    { kind: "row", rowId: "a", position: 0, occurrence: 0 },
    { kind: "row", rowId: "b", position: 2, occurrence: 0 },
    { kind: "row", rowId: "b", position: 2, occurrence: 1 },
    { kind: "row", rowId: "d", position: 4, occurrence: 0 },
  ];

  it("keeps the same occurrence when its row mounts or unmounts", () => {
    expect(
      resolveAnchoredIndex(matches, { rowId: "b", position: 2, occurrence: 1 }),
    ).toBe(2);
  });

  it("falls back to the row's last match, then the next row", () => {
    expect(
      resolveAnchoredIndex(matches, { rowId: "b", position: 2, occurrence: 5 }),
    ).toBe(2);
    expect(
      resolveAnchoredIndex(matches, { rowId: "c", position: 3, occurrence: 0 }),
    ).toBe(3);
    expect(
      resolveAnchoredIndex(matches, { rowId: "z", position: 9, occurrence: 0 }),
    ).toBe(0);
  });
});

describe("firstMatchAtOrBelowViewTop", () => {
  it("skips rows above the view and picks the first visible or later match", () => {
    const above = domRange("needle");
    const below = domRange("needle");
    const matches: ThreadFindMatch[] = [
      { kind: "row", rowId: "a", position: 0, occurrence: 0 },
      { kind: "dom", range: above, rowId: "b", position: 2, occurrence: 0 },
      { kind: "dom", range: below, rowId: "c", position: 3, occurrence: 0 },
      { kind: "row", rowId: "d", position: 4, occurrence: 0 },
    ];

    expect(
      firstMatchAtOrBelowViewTop(matches, (range) => range === below, 3),
    ).toBe(2);
    expect(firstMatchAtOrBelowViewTop(matches, () => false, 3)).toBe(3);
    expect(firstMatchAtOrBelowViewTop(matches, () => false, 4)).toBe(0);
  });
});
