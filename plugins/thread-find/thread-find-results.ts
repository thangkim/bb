import {
  countRowMatches,
  resolveRowPosition,
  type ThreadTextIndex,
} from "./thread-find-index.js";

export interface MountedMatchRow {
  id: string | null;
  position: number;
}

export interface DomThreadFindMatch {
  kind: "dom";
  range: Range;
  rowId: string | null;
  position: number;
  occurrence: number;
}

export interface RowThreadFindMatch {
  kind: "row";
  rowId: string;
  position: number;
  occurrence: number;
}

export type ThreadFindMatch = DomThreadFindMatch | RowThreadFindMatch;

export interface ThreadFindAnchor {
  rowId: string | null;
  position: number;
  occurrence: number;
}

export interface ObservedRowMatches {
  count: number;
  position: number;
}

const UNKNOWN_ROW_OFFSET = 0.001;

export function positionMountedRows(
  rowIds: readonly (string | null)[],
  index: ThreadTextIndex | null,
): number[] {
  if (index === null) return rowIds.map((_, order) => order);
  let previous = -1;
  return rowIds.map((id) => {
    const known = id === null ? null : resolveRowPosition(index, id);
    previous = known ?? previous + UNKNOWN_ROW_OFFSET;
    return previous;
  });
}

export function indexMatchesMountedRows(
  rowIds: readonly (string | null)[],
  index: ThreadTextIndex,
): boolean {
  const ids = rowIds.filter((id): id is string => id !== null);
  return (
    ids.length === 0 || ids.some((id) => resolveRowPosition(index, id) !== null)
  );
}

interface CollectThreadFindMatchesArgs {
  ranges: readonly Range[];
  rowOfRange: (range: Range) => MountedMatchRow | null;
  mountedRows: readonly MountedMatchRow[];
  index: ThreadTextIndex | null;
  query: string;
  observed: Map<string, ObservedRowMatches>;
}

function domMatches(
  ranges: readonly Range[],
  rowOfRange: (range: Range) => MountedMatchRow | null,
): DomThreadFindMatch[] {
  const occurrences = new Map<string | null, number>();
  let previousPosition = -1;
  return ranges.map((range) => {
    const row = rowOfRange(range);
    const rowId = row?.id ?? null;
    const position = row?.position ?? previousPosition;
    previousPosition = position;
    const occurrence = occurrences.get(rowId) ?? 0;
    occurrences.set(rowId, occurrence + 1);
    return { kind: "dom", range, rowId, position, occurrence };
  });
}

function rowMatches(
  index: ThreadTextIndex,
  query: string,
  mountedIds: ReadonlySet<string>,
  observed: ReadonlyMap<string, ObservedRowMatches>,
): RowThreadFindMatch[] {
  const counts = new Map<string, ObservedRowMatches>();
  for (const row of index.textRows) {
    if (mountedIds.has(row.id)) continue;
    const position = resolveRowPosition(index, row.id);
    if (position === null) continue;
    counts.set(row.id, { count: countRowMatches(row, query), position });
  }
  for (const [rowId, seen] of observed) {
    if (mountedIds.has(rowId)) continue;
    const position = resolveRowPosition(index, rowId) ?? seen.position;
    counts.set(rowId, { count: seen.count, position });
  }
  const matches: RowThreadFindMatch[] = [];
  for (const [rowId, { count, position }] of counts) {
    for (let occurrence = 0; occurrence < count; occurrence += 1) {
      matches.push({ kind: "row", rowId, position, occurrence });
    }
  }
  return matches.sort((left, right) => left.position - right.position);
}

export function collectThreadFindMatches({
  ranges,
  rowOfRange,
  mountedRows,
  index,
  query,
  observed,
}: CollectThreadFindMatchesArgs): ThreadFindMatch[] {
  const fromDom = domMatches(ranges, rowOfRange);
  if (index === null || query.length === 0) return fromDom;
  const mountedIds = new Set<string>();
  for (const row of mountedRows) {
    if (row.id === null) continue;
    mountedIds.add(row.id);
    observed.set(row.id, { count: 0, position: row.position });
  }
  for (const match of fromDom) {
    if (match.rowId === null) continue;
    const seen = observed.get(match.rowId);
    if (seen !== undefined) seen.count += 1;
  }
  const fromRows = rowMatches(index, query, mountedIds, observed);
  const merged: ThreadFindMatch[] = [];
  let rowCursor = 0;
  for (const match of fromDom) {
    while (
      rowCursor < fromRows.length &&
      (fromRows[rowCursor]?.position ?? 0) < match.position
    ) {
      const next = fromRows[rowCursor];
      if (next !== undefined) merged.push(next);
      rowCursor += 1;
    }
    merged.push(match);
  }
  merged.push(...fromRows.slice(rowCursor));
  return merged;
}

export function anchorOf(match: ThreadFindMatch): ThreadFindAnchor {
  return {
    rowId: match.rowId,
    position: match.position,
    occurrence: match.occurrence,
  };
}

export function resolveAnchoredIndex(
  matches: readonly ThreadFindMatch[],
  anchor: ThreadFindAnchor | null,
): number {
  if (matches.length === 0 || anchor === null) return 0;
  let lastInRow = -1;
  for (const [index, match] of matches.entries()) {
    const sameRow =
      anchor.rowId === null
        ? match.rowId === null && match.position === anchor.position
        : match.rowId === anchor.rowId;
    if (!sameRow) continue;
    if (match.occurrence === anchor.occurrence) return index;
    lastInRow = index;
  }
  if (lastInRow !== -1) return lastInRow;
  const after = matches.findIndex((match) => match.position > anchor.position);
  return after === -1 ? 0 : after;
}

export function firstMatchAtOrBelowViewTop(
  matches: readonly ThreadFindMatch[],
  isRangeBelowTop: (range: Range) => boolean,
  lastPositionInView: number,
): number {
  const index = matches.findIndex((match) =>
    match.kind === "dom"
      ? isRangeBelowTop(match.range)
      : match.position > lastPositionInView,
  );
  return index === -1 ? 0 : index;
}
