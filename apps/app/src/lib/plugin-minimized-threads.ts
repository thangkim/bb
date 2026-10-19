import { useSyncExternalStore } from "react";

type MinimizedThreadsListener = () => void;
type MinimizedThreadsOwner = string | symbol;

interface MinimizedThreadsEntry {
  pluginId: string;
  threadIds: ReadonlySet<string>;
}

const EMPTY_THREAD_IDS: ReadonlySet<string> = new Set();

const entriesByOwner = new Map<MinimizedThreadsOwner, MinimizedThreadsEntry>();
const listeners = new Set<MinimizedThreadsListener>();
let snapshot: ReadonlySet<string> = EMPTY_THREAD_IDS;

function sameThreadIds(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const threadId of left) {
    if (!right.has(threadId)) return false;
  }
  return true;
}

function recompute(): void {
  const next = new Set<string>();
  for (const { threadIds } of entriesByOwner.values()) {
    for (const threadId of threadIds) next.add(threadId);
  }
  if (sameThreadIds(snapshot, next)) return;
  snapshot = next.size === 0 ? EMPTY_THREAD_IDS : next;
  for (const listener of [...listeners]) {
    listener();
  }
}

export function normalizeMinimizedThreadIds(
  value: unknown,
): ReadonlySet<string> | null {
  if (!(value instanceof Set)) return null;
  const threadIds = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") return null;
    const threadId = candidate.trim();
    if (threadId.length === 0) return null;
    threadIds.add(threadId);
  }
  return threadIds;
}

export function getPluginMinimizedThreadIds(): ReadonlySet<string> {
  return snapshot;
}

export function setPluginMinimizedThreadIds(
  pluginId: string,
  owner: MinimizedThreadsOwner,
  threadIds: ReadonlySet<string>,
): void {
  if (threadIds.size === 0) {
    entriesByOwner.delete(owner);
  } else {
    entriesByOwner.set(owner, { pluginId, threadIds: new Set(threadIds) });
  }
  recompute();
}

export function clearPluginMinimizedThreadIds(pluginId: string): void {
  for (const [owner, entry] of entriesByOwner) {
    if (entry.pluginId === pluginId) entriesByOwner.delete(owner);
  }
  recompute();
}

export function clearPluginMinimizedThreadIdsByOwner(
  owner: MinimizedThreadsOwner,
): void {
  if (!entriesByOwner.delete(owner)) return;
  recompute();
}

export function subscribePluginMinimizedThreadIds(
  listener: MinimizedThreadsListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePluginMinimizedThreadIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribePluginMinimizedThreadIds,
    getPluginMinimizedThreadIds,
    getPluginMinimizedThreadIds,
  );
}

export function resetPluginMinimizedThreadIdsForTest(): void {
  entriesByOwner.clear();
  recompute();
}
