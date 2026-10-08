import { useState, type DragEvent } from "react";
import { cn } from "@/lib/utils";

const POSITION_STEP = 1_024;
const REORDER_DRAG_TYPE = "application/x-my-tasks-reorder";

export type DropPlacement = "before" | "after";

interface ReorderDrag {
  kind: string;
  scopeId: string;
  itemId: string;
}

let activeDrag: ReorderDrag | null = null;

export function isReorderDragIn(
  dataTransfer: DataTransfer,
  kind: string,
  scopeId: string,
): boolean {
  return (
    activeDrag !== null &&
    activeDrag.kind === kind &&
    activeDrag.scopeId === scopeId &&
    Array.from(dataTransfer.types ?? []).includes(REORDER_DRAG_TYPE)
  );
}

interface Positioned {
  id: string;
  position: number;
}

export interface ReorderNeighbors<T> {
  before: T | undefined;
  after: T | undefined;
}

export function reorderNeighbors<T extends { id: string }>(
  items: readonly T[],
  draggedId: string,
  targetId: string,
  placement: DropPlacement,
): ReorderNeighbors<T> | null {
  if (draggedId === targetId) return null;
  const currentIndex = items.findIndex((item) => item.id === draggedId);
  if (currentIndex < 0) return null;
  const rest = items.filter((item) => item.id !== draggedId);
  const targetIndex = rest.findIndex((item) => item.id === targetId);
  if (targetIndex < 0) return null;
  const insertAt = placement === "before" ? targetIndex : targetIndex + 1;
  if (insertAt === currentIndex) return null;
  return { before: rest[insertAt - 1], after: rest[insertAt] };
}

export function positionBetween(
  before: Positioned | undefined,
  after: Positioned | undefined,
): number {
  if (before && after) return (before.position + after.position) / 2;
  if (before) return before.position + POSITION_STEP;
  if (after) return after.position - POSITION_STEP;
  return POSITION_STEP;
}

function placementFor(event: DragEvent<HTMLElement>): DropPlacement {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

interface ReorderListOptions<T> {
  kind: string;
  scopeId: string;
  items: readonly T[];
  onReorder: (item: T, neighbors: ReorderNeighbors<T>) => void;
}

export interface ReorderItemProps {
  draggable: true;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

interface DropIndicator {
  itemId: string;
  placement: DropPlacement;
}

export function useReorderList<T extends { id: string }>({
  kind,
  scopeId,
  items,
  onReorder,
}: ReorderListOptions<T>) {
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);

  const ownedDrag = (event: DragEvent<HTMLElement>): ReorderDrag | null =>
    isReorderDragIn(event.dataTransfer, kind, scopeId) ? activeDrag : null;

  const itemProps = (item: T): ReorderItemProps => ({
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      activeDrag = { kind, scopeId, itemId: item.id };
      event.dataTransfer.setData(REORDER_DRAG_TYPE, item.id);
      event.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => {
      activeDrag = null;
      setIndicator(null);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (ownedDrag(event) === null) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      const placement = placementFor(event);
      setIndicator((current) =>
        current?.itemId === item.id && current.placement === placement
          ? current
          : { itemId: item.id, placement },
      );
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const drag = ownedDrag(event);
      if (drag === null) return;
      event.preventDefault();
      event.stopPropagation();
      activeDrag = null;
      setIndicator(null);
      const dragged = items.find((entry) => entry.id === drag.itemId);
      const neighbors = reorderNeighbors(
        items,
        drag.itemId,
        item.id,
        placementFor(event),
      );
      if (dragged && neighbors) onReorder(dragged, neighbors);
    },
  });

  const listProps = {
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      setIndicator(null);
    },
  };

  const dropPlacement = (itemId: string): DropPlacement | null =>
    indicator?.itemId === itemId ? indicator.placement : null;

  return { itemProps, listProps, dropPlacement };
}

export function DropLine({ placement }: { placement: DropPlacement | null }) {
  if (placement === null) return null;
  return (
    <span
      aria-hidden
      data-drop-line={placement}
      className={cn(
        "pointer-events-none absolute inset-x-0 z-20 h-0.5 rounded-full bg-primary",
        placement === "before" ? "-top-px" : "-bottom-px",
      )}
    />
  );
}
