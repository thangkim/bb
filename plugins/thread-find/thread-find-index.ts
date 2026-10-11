import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { findTextOffsets } from "./thread-find-matches.js";

type ThreadTimeline = Awaited<
  ReturnType<PluginBrowserBbSdk["threads"]["timeline"]>
>;
type TimelineRow = ThreadTimeline["rows"][number];
type ThreadTimelineApi = Pick<PluginBrowserBbSdk["threads"], "timeline">;

export const THREAD_FIND_INDEX_SEGMENT_LIMIT = 100;
export const THREAD_FIND_INDEX_MAX_PAGES = 40;

const WORK_SUMMARY_ID_MARKER = ":work-summary:";

export interface ThreadTextRow {
  id: string;
  text: string;
}

export interface ThreadTextIndex {
  rowIds: readonly string[];
  positions: ReadonlyMap<string, number>;
  textRows: readonly ThreadTextRow[];
}

export function plainTextFromMarkdown(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gmu, "")
    .replace(/\*\*|__|~~|`+/gu, "");
}

export function buildThreadTextIndex(
  rows: readonly TimelineRow[],
): ThreadTextIndex {
  const rowIds: string[] = [];
  const positions = new Map<string, number>();
  const textRows: ThreadTextRow[] = [];
  for (const row of rows) {
    if (positions.has(row.id)) continue;
    positions.set(row.id, rowIds.length);
    rowIds.push(row.id);
    if (row.kind === "conversation") {
      textRows.push({ id: row.id, text: plainTextFromMarkdown(row.text) });
    }
  }
  return { rowIds, positions, textRows };
}

export function resolveRowPosition(
  index: ThreadTextIndex,
  rowId: string,
): number | null {
  const direct = index.positions.get(rowId);
  if (direct !== undefined) return direct;
  const marker = rowId.lastIndexOf(WORK_SUMMARY_ID_MARKER);
  if (marker === -1) return null;
  return (
    index.positions.get(rowId.slice(marker + WORK_SUMMARY_ID_MARKER.length)) ??
    null
  );
}

export function countRowMatches(row: ThreadTextRow, query: string): number {
  return findTextOffsets(row.text, query).length;
}

function olderPageArgs(page: ThreadTimeline["timelinePage"]) {
  if (!page.hasOlderRows || page.olderCursor === null) return null;
  return {
    beforeAnchorSeq: String(page.olderCursor.anchorSeq),
    beforeAnchorId: page.olderCursor.anchorId,
  };
}

export async function loadThreadTextIndex(
  threads: ThreadTimelineApi,
  threadId: string,
  signal: AbortSignal,
): Promise<ThreadTextIndex> {
  const segmentLimit = String(THREAD_FIND_INDEX_SEGMENT_LIMIT);
  const latest = await threads.timeline({ threadId, signal, segmentLimit });
  const pages: TimelineRow[][] = [latest.rows];
  let cursor = olderPageArgs(latest.timelinePage);
  for (
    let count = 1;
    cursor !== null && count < THREAD_FIND_INDEX_MAX_PAGES;
    count += 1
  ) {
    const older = await threads.timeline({
      threadId,
      signal,
      segmentLimit,
      ...cursor,
    });
    pages.unshift(older.rows);
    cursor = olderPageArgs(older.timelinePage);
  }
  return buildThreadTextIndex(pages.flat());
}

export async function refreshLatestThreadText(
  threads: ThreadTimelineApi,
  threadId: string,
  previous: ThreadTextIndex,
  signal: AbortSignal,
): Promise<ThreadTextIndex> {
  const latest = await threads.timeline({
    threadId,
    signal,
    segmentLimit: String(THREAD_FIND_INDEX_SEGMENT_LIMIT),
  });
  const overlap = latest.rows
    .map((row) => previous.positions.get(row.id))
    .find((position) => position !== undefined);
  if (overlap === undefined) {
    return loadThreadTextIndex(threads, threadId, signal);
  }
  const textById = new Map(previous.textRows.map((row) => [row.id, row]));
  const olderRows = previous.rowIds.slice(0, overlap);
  const olderIds = new Set(olderRows);
  const latestIndex = buildThreadTextIndex(latest.rows);
  const rowIds = [
    ...olderRows,
    ...latestIndex.rowIds.filter((id) => !olderIds.has(id)),
  ];
  const latestText = new Map(latestIndex.textRows.map((row) => [row.id, row]));
  return {
    rowIds,
    positions: new Map(rowIds.map((id, position) => [id, position])),
    textRows: rowIds.flatMap((id) => {
      const row = latestText.get(id) ?? textById.get(id);
      return row === undefined ? [] : [row];
    }),
  };
}
