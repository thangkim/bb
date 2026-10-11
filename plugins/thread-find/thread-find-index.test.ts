import { describe, expect, it } from "vitest";
import {
  buildThreadTextIndex,
  loadThreadTextIndex,
  plainTextFromMarkdown,
  refreshLatestThreadText,
  resolveRowPosition,
} from "./thread-find-index";

type IndexRows = Parameters<typeof buildThreadTextIndex>[0];
type TimelineApi = Parameters<typeof loadThreadTextIndex>[0];
type TimelineArgs = Parameters<TimelineApi["timeline"]>[0];

function rows(
  ...entries: ({ id: string; text: string } | { id: string; kind: "work" })[]
): IndexRows {
  return entries.map((entry) =>
    "text" in entry
      ? { id: entry.id, kind: "conversation", role: "user", text: entry.text }
      : { id: entry.id, kind: "work" },
  ) as never;
}

function page(
  pageRows: IndexRows,
  olderCursor: { anchorSeq: number; anchorId: string } | null,
) {
  return {
    rows: pageRows,
    timelinePage: { hasOlderRows: olderCursor !== null, olderCursor },
  } as never;
}

function fakeTimeline(
  respond: (args: TimelineArgs) => ReturnType<typeof page>,
): { api: TimelineApi; calls: TimelineArgs[] } {
  const calls: TimelineArgs[] = [];
  return {
    calls,
    api: {
      timeline: async (args) => {
        calls.push(args);
        return respond(args);
      },
    },
  };
}

describe("plainTextFromMarkdown", () => {
  it("drops markup that the rendered message does not show", () => {
    expect(
      plainTextFromMarkdown(
        "## Plan\n- run **the** `deploy` [script](https://x.dev)\n> ~~old~~ note",
      ),
    ).toBe("Plan\nrun the deploy script\nold note");
  });
});

describe("buildThreadTextIndex", () => {
  it("orders every row and keeps only conversation text", () => {
    const index = buildThreadTextIndex(
      rows(
        { id: "a", text: "hi" },
        { id: "w", kind: "work" },
        {
          id: "b",
          text: "**bye**",
        },
      ),
    );

    expect(index.rowIds).toEqual(["a", "w", "b"]);
    expect(index.textRows).toEqual([
      { id: "a", text: "hi" },
      { id: "b", text: "bye" },
    ]);
  });

  it("places work summary rows at their first child", () => {
    const index = buildThreadTextIndex(
      rows({ id: "a", text: "hi" }, { id: "w1", kind: "work" }),
    );

    expect(resolveRowPosition(index, "thread-1:turn-1:work-summary:w1")).toBe(
      1,
    );
    expect(resolveRowPosition(index, "unknown")).toBeNull();
  });
});

describe("loadThreadTextIndex", () => {
  it("pages older rows in front of the latest page", async () => {
    const { api, calls } = fakeTimeline((args) =>
      args.beforeAnchorId === undefined
        ? page(rows({ id: "c", text: "three" }), {
            anchorSeq: 7,
            anchorId: "c",
          })
        : page(rows({ id: "a", text: "one" }, { id: "b", text: "two" }), null),
    );

    const index = await loadThreadTextIndex(
      api,
      "thread-1",
      new AbortController().signal,
    );

    expect(index.rowIds).toEqual(["a", "b", "c"]);
    expect(calls.map(({ signal: _signal, ...args }) => args)).toEqual([
      { threadId: "thread-1", segmentLimit: "100" },
      {
        threadId: "thread-1",
        segmentLimit: "100",
        beforeAnchorSeq: "7",
        beforeAnchorId: "c",
      },
    ]);
  });
});

describe("refreshLatestThreadText", () => {
  it("replaces the tail from the latest page and keeps older rows", async () => {
    const previous = buildThreadTextIndex(
      rows(
        { id: "a", text: "one" },
        { id: "b", text: "two" },
        { id: "c", text: "draft" },
      ),
    );
    const { api, calls } = fakeTimeline(() =>
      page(
        rows(
          { id: "b", text: "two" },
          { id: "c", text: "final" },
          {
            id: "d",
            text: "four",
          },
        ),
        { anchorSeq: 1, anchorId: "b" },
      ),
    );

    const refreshed = await refreshLatestThreadText(
      api,
      "thread-1",
      previous,
      new AbortController().signal,
    );

    expect(calls).toHaveLength(1);
    expect(refreshed.rowIds).toEqual(["a", "b", "c", "d"]);
    expect(refreshed.textRows.map((row) => row.text)).toEqual([
      "one",
      "two",
      "final",
      "four",
    ]);
    expect(resolveRowPosition(refreshed, "d")).toBe(3);
  });
});
