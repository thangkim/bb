import { useSyncExternalStore } from "react";

export const TIMELINE_RENDER_ALL_ATTRIBUTE = "data-bb-timeline-render-all";

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (observer === null) {
    observer = new MutationObserver(notifyListeners);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [TIMELINE_RENDER_ALL_ATTRIBUTE],
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    observer?.disconnect();
    observer = null;
  };
}

function isTimelineRenderAllRequested(): boolean {
  return document.documentElement.hasAttribute(TIMELINE_RENDER_ALL_ATTRIBUTE);
}

function isTimelineRenderAllRequestedOnServer(): boolean {
  return false;
}

export function useTimelineRenderAllRequested(): boolean {
  return useSyncExternalStore(
    subscribe,
    isTimelineRenderAllRequested,
    isTimelineRenderAllRequestedOnServer,
  );
}
