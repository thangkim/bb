import { useSyncExternalStore } from "react";

interface TerminalOpenRequest {
  threadId: string;
  terminalId: string;
}

const REQUEST_TTL_MS = 30_000;

let pending: (TerminalOpenRequest & { at: number }) | null = null;
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function requestTerminalOpen(request: TerminalOpenRequest): void {
  pending = { ...request, at: Date.now() };
  notify();
}

export function takeTerminalOpen(threadId: string): string | null {
  if (pending === null || pending.threadId !== threadId) return null;
  const { terminalId, at } = pending;
  pending = null;
  return Date.now() - at <= REQUEST_TTL_MS ? terminalId : null;
}

export function useTerminalOpenRequests(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );
}
