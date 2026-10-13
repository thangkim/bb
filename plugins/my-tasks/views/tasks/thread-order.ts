import { useMemo } from "react";
import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";

export type ThreadActivity = ReadonlyMap<string, number>;

export function useThreadActivity(): ThreadActivity {
  const { threads } = experimental_useSidebarThreads();
  return useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread.updatedAt])),
    [threads],
  );
}

interface AttachedThread {
  id: string;
  threadId: string;
  attachedAt: string;
}

function lastActivity(thread: AttachedThread, activity: ThreadActivity) {
  return activity.get(thread.threadId) ?? Date.parse(thread.attachedAt);
}

export function byRecentActivity<T extends AttachedThread>(
  threads: readonly T[],
  activity: ThreadActivity,
): T[] {
  return [...threads].sort(
    (a, b) =>
      lastActivity(b, activity) - lastActivity(a, activity) ||
      b.id.localeCompare(a.id),
  );
}

export function useThreadsByRecentActivity<T extends AttachedThread>(
  threads: readonly T[],
): T[] {
  const activity = useThreadActivity();
  return useMemo(
    () => byRecentActivity(threads, activity),
    [threads, activity],
  );
}
