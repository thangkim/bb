import { PRIORITIES, type Priority } from "./contract.js";
import type { TaskSort } from "./pagination.js";

interface Sortable {
  priority: Priority;
  dueDate: string | null;
  position: number;
}

const PRIORITY_RANK = new Map<Priority, number>(
  PRIORITIES.map((priority, index) => [priority, index]),
);

function byPriority(a: Sortable, b: Sortable): number {
  return (
    (PRIORITY_RANK.get(a.priority) ?? PRIORITIES.length) -
    (PRIORITY_RANK.get(b.priority) ?? PRIORITIES.length)
  );
}

function byDueDate(a: Sortable, b: Sortable): number {
  if (a.dueDate === null) return b.dueDate === null ? 0 : 1;
  if (b.dueDate === null) return -1;
  return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
}

function byPosition(a: Sortable, b: Sortable): number {
  return a.position - b.position;
}

export function sortItems<T extends Sortable>(
  items: readonly T[],
  sort: TaskSort,
): T[] {
  if (sort === "manual") return [...items].sort(byPosition);
  const [primary, secondary] =
    sort === "priority" ? [byPriority, byDueDate] : [byDueDate, byPriority];
  return [...items].sort(
    (a, b) => primary(a, b) || secondary(a, b) || byPosition(a, b),
  );
}
