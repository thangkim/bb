export interface ThreadLinksTarget {
  threadId: string;
  projectId: string;
  request: number;
}

let target: ThreadLinksTarget | null = null;
let requestCount = 0;
const listeners = new Set<() => void>();

function publish(next: ThreadLinksTarget | null): void {
  target = next;
  for (const listener of listeners) listener();
}

export function subscribeThreadLinks(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getThreadLinksTarget(): ThreadLinksTarget | null {
  return target;
}

export function openThreadLinks(input: {
  threadId: string;
  projectId: string;
}): void {
  requestCount += 1;
  publish({ ...input, request: requestCount });
}

export function closeThreadLinks(): void {
  if (target !== null) publish(null);
}
