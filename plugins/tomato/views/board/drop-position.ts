import { PROJECT_STATUSES, type ProjectStatus } from "../../shared/contract.js";

export const BOARD_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
] as const satisfies readonly ProjectStatus[];

export function visibleBoardStatuses(
  columns: Readonly<Record<ProjectStatus, readonly unknown[]>>,
): ProjectStatus[] {
  return [
    ...BOARD_STATUSES,
    ...(columns.canceled.length > 0 ? (["canceled"] as const) : []),
  ];
}

interface BoardDropNeighbors {
  beforeId: string | null;
  afterId: string | null;
}

export function dropNeighborsForIndex(
  columnIds: readonly string[],
  draggedId: string,
  dropIndex: number,
): BoardDropNeighbors {
  const ids = columnIds.filter((id) => id !== draggedId);
  const index = Math.max(0, Math.min(dropIndex, ids.length));
  return {
    beforeId: ids[index - 1] ?? null,
    afterId: ids[index] ?? null,
  };
}

export function dropIndexForPointer(
  cardCenterYs: readonly number[],
  pointerY: number,
): number {
  let index = 0;
  for (const centerY of cardCenterYs) {
    if (pointerY > centerY) index += 1;
  }
  return index;
}

export type BoardColumns<T> = Record<ProjectStatus, T[]>;

export function emptyColumns<T>(): BoardColumns<T> {
  return {
    backlog: [],
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
    canceled: [],
  };
}

export function applyBoardMove<T extends { id: string; status: ProjectStatus }>(
  columns: Readonly<Record<ProjectStatus, readonly T[]>>,
  itemId: string,
  toStatus: ProjectStatus,
  dropIndex: number,
): BoardColumns<T> {
  let moved: T | undefined;
  const next = emptyColumns<T>();
  for (const status of PROJECT_STATUSES) {
    next[status] = columns[status].filter((item) => {
      if (item.id !== itemId) return true;
      moved = item;
      return false;
    });
  }
  if (!moved) return next;
  const destination = next[toStatus];
  const index = Math.max(0, Math.min(dropIndex, destination.length));
  destination.splice(index, 0, { ...moved, status: toStatus });
  return next;
}
