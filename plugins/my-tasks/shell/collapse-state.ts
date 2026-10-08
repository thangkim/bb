import { useCallback, useSyncExternalStore } from "react";

export const COLLAPSED_STATUSES_STORAGE_KEY =
  "bb-my-tasks:list-collapsed-statuses";
export const EXPANDED_PROJECTS_STORAGE_KEY =
  "bb-my-tasks:list-expanded-projects";
export const COLLAPSED_FOLDERS_STORAGE_KEY =
  "bb-my-tasks:sidebar-collapsed-folders";

export type ToggleSetStorageKey =
  | typeof COLLAPSED_STATUSES_STORAGE_KEY
  | typeof EXPANDED_PROJECTS_STORAGE_KEY
  | typeof COLLAPSED_FOLDERS_STORAGE_KEY;

const EMPTY: ReadonlySet<string> = new Set();
const listeners = new Map<string, Set<() => void>>();
const snapshots = new Map<
  string,
  { raw: string | null; ids: ReadonlySet<string> }
>();

export function parseToggleSet(raw: string | null): ReadonlySet<string> {
  if (raw === null) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return new Set(
      parsed.filter(
        (value): value is string => typeof value === "string" && value !== "",
      ),
    );
  } catch {
    return EMPTY;
  }
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readToggleSet(key: ToggleSetStorageKey): ReadonlySet<string> {
  const raw = readRaw(key);
  const cached = snapshots.get(key);
  if (cached !== undefined && cached.raw === raw) return cached.ids;
  const ids = parseToggleSet(raw);
  snapshots.set(key, { raw, ids });
  return ids;
}

function notify(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
}

export function toggleStoredId(key: ToggleSetStorageKey, id: string): void {
  const next = new Set(readToggleSet(key));
  if (next.has(id)) next.delete(id);
  else next.add(id);
  try {
    window.localStorage.setItem(key, JSON.stringify([...next]));
  } catch {
    snapshots.set(key, { raw: readRaw(key), ids: next });
  }
  notify(key);
}

function subscribeTo(key: string, listener: () => void): () => void {
  let keyListeners = listeners.get(key);
  if (keyListeners === undefined) {
    keyListeners = new Set();
    listeners.set(key, keyListeners);
  }
  keyListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    keyListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePersistedToggleSet(
  key: ToggleSetStorageKey,
): readonly [ReadonlySet<string>, (id: string) => void] {
  const subscribe = useCallback(
    (listener: () => void) => subscribeTo(key, listener),
    [key],
  );
  const ids = useSyncExternalStore(
    subscribe,
    () => readToggleSet(key),
    () => EMPTY,
  );
  const toggle = useCallback((id: string) => toggleStoredId(key, id), [key]);
  return [ids, toggle] as const;
}
