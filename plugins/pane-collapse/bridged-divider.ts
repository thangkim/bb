import { GRID_DIVIDER_ATTRIBUTE, GRID_ROOT_SELECTOR } from "./collapsed-panes";

const HIT_TARGET_SELECTOR = "[data-split-divider-hit-target]";
const MIN_PAIR_FRACTION = 0.15;
const MAX_PAIR_FRACTION = 0.85;

export interface BridgedPair {
  previous: HTMLElement;
  next: HTMLElement;
}

function isHidden(element: Element): boolean {
  return getComputedStyle(element).display === "none";
}

function nearestVisibleCell(
  divider: HTMLElement,
  step: (element: Element) => Element | null,
): { cell: HTMLElement; bridged: boolean } | null {
  let bridged = false;
  for (let node = step(divider); node !== null; node = step(node)) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.hasAttribute(GRID_DIVIDER_ATTRIBUTE)) continue;
    if (isHidden(node)) {
      bridged = true;
      continue;
    }
    return { cell: node, bridged };
  }
  return null;
}

export function bridgedPair(divider: HTMLElement): BridgedPair | null {
  if (!divider.parentElement?.matches(GRID_ROOT_SELECTOR)) return null;
  const previous = nearestVisibleCell(
    divider,
    (node) => node.previousElementSibling,
  );
  const next = nearestVisibleCell(divider, (node) => node.nextElementSibling);
  if (previous === null || next === null) return null;
  if (!previous.bridged && !next.bridged) return null;
  return { previous: previous.cell, next: next.cell };
}

function cellGrow(cell: HTMLElement): number | null {
  const grow = Number.parseFloat(
    cell.style.flexGrow ||
      cell.style.flex.split(" ")[0] ||
      getComputedStyle(cell).flexGrow,
  );
  return Number.isFinite(grow) && grow > 0 ? grow : null;
}

export function pairFraction(
  pointer: number,
  start: number,
  contentSpan: number,
  dividerExtent: number,
): number {
  const fraction =
    contentSpan > 0 ? (pointer - start - dividerExtent / 2) / contentSpan : 0.5;
  return Math.min(MAX_PAIR_FRACTION, Math.max(MIN_PAIR_FRACTION, fraction));
}

function startDrag(
  event: PointerEvent,
  hitTarget: HTMLElement,
  divider: HTMLElement,
  { previous, next }: BridgedPair,
): void {
  const horizontal = divider.getAttribute("aria-orientation") !== "horizontal";
  const previousRect = previous.getBoundingClientRect();
  const nextRect = next.getBoundingClientRect();
  const dividerRect = divider.getBoundingClientRect();
  const start = horizontal ? previousRect.left : previousRect.top;
  const contentSpan = horizontal
    ? previousRect.width + nextRect.width
    : previousRect.height + nextRect.height;
  const dividerExtent = horizontal ? dividerRect.width : dividerRect.height;
  if (contentSpan <= 0) return;
  event.preventDefault();
  event.stopPropagation();

  const previousGrow = cellGrow(previous);
  const nextGrow = cellGrow(next);
  const total =
    previousGrow !== null && nextGrow !== null ? previousGrow + nextGrow : 1;
  const previousFlex = previous.style.flex;
  const nextFlex = next.style.flex;
  const pointerId = event.pointerId;
  hitTarget.setPointerCapture?.(pointerId);
  divider.dataset.dragging = "true";

  const onMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    const fraction = pairFraction(
      horizontal ? moveEvent.clientX : moveEvent.clientY,
      start,
      contentSpan,
      dividerExtent,
    );
    previous.style.flex = `${total * fraction} 1 0px`;
    next.style.flex = `${total * (1 - fraction)} 1 0px`;
  };
  const finish = (commit: boolean) => {
    delete divider.dataset.dragging;
    hitTarget.removeEventListener("pointermove", onMove);
    hitTarget.removeEventListener("pointerup", onUp);
    hitTarget.removeEventListener("pointercancel", onCancel);
    hitTarget.removeEventListener("lostpointercapture", onCancel);
    if (hitTarget.hasPointerCapture?.(pointerId)) {
      hitTarget.releasePointerCapture(pointerId);
    }
    if (commit) return;
    previous.style.flex = previousFlex;
    next.style.flex = nextFlex;
  };
  const onUp = (upEvent: PointerEvent) => {
    if (upEvent.pointerId === pointerId) finish(true);
  };
  const onCancel = (cancelEvent: PointerEvent) => {
    if (cancelEvent.pointerId === pointerId) finish(false);
  };
  hitTarget.addEventListener("pointermove", onMove);
  hitTarget.addEventListener("pointerup", onUp);
  hitTarget.addEventListener("pointercancel", onCancel);
  hitTarget.addEventListener("lostpointercapture", onCancel);
}

export function installBridgedDividerDrag(doc: Document): () => void {
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const hitTarget = event.target.closest<HTMLElement>(HIT_TARGET_SELECTOR);
    const divider = hitTarget?.parentElement;
    if (!hitTarget || !divider?.hasAttribute(GRID_DIVIDER_ATTRIBUTE)) return;
    const pair = bridgedPair(divider);
    if (pair !== null) startDrag(event, hitTarget, divider, pair);
  };
  doc.addEventListener("pointerdown", onPointerDown, true);
  return () => doc.removeEventListener("pointerdown", onPointerDown, true);
}
