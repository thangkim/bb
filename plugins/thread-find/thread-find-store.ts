import { isInsideFindBar, resolveThreadWindow } from "./thread-find-dom.js";

export interface ThreadFindSession {
  threadWindow: HTMLElement;
  restoreFocus: HTMLElement | null;
  request: number;
}

let session: ThreadFindSession | null = null;
let requestCount = 0;
const listeners = new Set<() => void>();

function publish(next: ThreadFindSession | null): void {
  session = next;
  for (const listener of listeners) listener();
}

export function subscribeThreadFind(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getThreadFindSession(): ThreadFindSession | null {
  return session;
}

export function openThreadFind(
  threadWindow: HTMLElement,
  activeElement: Element | null,
): void {
  requestCount += 1;
  const restoreFocus = isInsideFindBar(activeElement)
    ? (session?.restoreFocus ?? null)
    : activeElement instanceof HTMLElement
      ? activeElement
      : null;
  publish({ threadWindow, restoreFocus, request: requestCount });
}

export function refocusThreadFind(): void {
  if (session === null) return;
  requestCount += 1;
  publish({ ...session, request: requestCount });
}

export function closeThreadFind(): ThreadFindSession | null {
  const closed = session;
  if (closed !== null) publish(null);
  return closed;
}

export function openThreadFindForFocus(doc: Document): boolean {
  const activeElement = doc.activeElement;
  if (session !== null && isInsideFindBar(activeElement)) {
    refocusThreadFind();
    return true;
  }
  const threadWindow = resolveThreadWindow(doc, activeElement);
  if (threadWindow === null) return false;
  openThreadFind(threadWindow, activeElement);
  return true;
}
