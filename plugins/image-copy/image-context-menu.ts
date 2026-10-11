export interface ImageContextTarget {
  imageUrl: string;
  linkUrl: string | null;
  selectionText: string;
  x: number;
  y: number;
}

export interface MenuSize {
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export const IMAGE_CONTEXT_MENU_VIEWPORT_MARGIN_PX = 8;

const EDITABLE_ANCESTOR_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function contextImageOf(target: EventTarget | null): HTMLImageElement | null {
  if (target instanceof HTMLImageElement) return target;
  if (!(target instanceof Element)) return null;
  const image = target.closest("img");
  return image instanceof HTMLImageElement ? image : null;
}

function isTouchContextMenu(event: MouseEvent): boolean {
  const pointerType: unknown = Reflect.get(event, "pointerType");
  return pointerType === "touch" || pointerType === "pen";
}

function linkUrlOf(image: HTMLImageElement): string | null {
  const anchor = image.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  return anchor.href.length > 0 ? anchor.href : null;
}

export function resolveImageContextTarget(
  event: MouseEvent,
  selectionText: string,
): ImageContextTarget | null {
  if (event.defaultPrevented || event.shiftKey || isTouchContextMenu(event)) {
    return null;
  }
  const image = contextImageOf(event.target);
  if (image === null || !image.isConnected) return null;
  if (image.closest(EDITABLE_ANCESTOR_SELECTOR) !== null) return null;
  if (!image.complete || image.naturalWidth === 0) return null;
  const imageUrl = image.currentSrc || image.src;
  if (imageUrl.length === 0) return null;
  return {
    imageUrl,
    linkUrl: linkUrlOf(image),
    selectionText,
    x: event.clientX,
    y: event.clientY,
  };
}

function clampAxis(start: number, size: number, limit: number): number {
  const margin = IMAGE_CONTEXT_MENU_VIEWPORT_MARGIN_PX;
  const fitsAfter = start + size <= limit - margin;
  const preferred = fitsAfter ? start : start - size;
  return Math.max(margin, Math.min(preferred, limit - margin - size));
}

export function placeImageContextMenu(
  anchor: { x: number; y: number },
  menu: MenuSize,
  viewport: ViewportSize,
): { left: number; top: number } {
  return {
    left: clampAxis(anchor.x, menu.width, viewport.width),
    top: clampAxis(anchor.y, menu.height, viewport.height),
  };
}
