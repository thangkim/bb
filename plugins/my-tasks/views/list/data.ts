import { useMemo } from "react";
import {
  listAllTasks,
  useSidebarSummary,
  useTasksQuery,
} from "../../shell/data.js";
import type {
  Label,
  SidebarProjectSummary,
  Task,
  TaskThread,
} from "../../shared/contract.js";
import { sortItems } from "../../shared/sort.js";
import { isActiveThread } from "../detail/meta.js";

export function useProjectSummaries(): Map<string, SidebarProjectSummary> {
  const summaries = useSidebarSummary();
  return useMemo(
    () =>
      new Map(
        (summaries.data ?? []).map((summary) => [summary.projectId, summary]),
      ),
    [summaries.data],
  );
}

export function useProjectTasks(projectId: string) {
  return useTasksQuery<Task[]>(
    async (rpc) => sortItems(await listAllTasks(rpc, { projectId }), "manual"),
    ["tasks:changed", "threads:changed"],
    [projectId],
  );
}

export function useLabels(projectIds: readonly string[]) {
  return useTasksQuery<Label[]>(
    async (rpc) => {
      const results = await Promise.all(
        projectIds.map((projectId) => rpc.call("listLabels", { projectId })),
      );
      return results.flatMap((result) => result.labels);
    },
    ["projects:changed"],
    [projectIds.join()],
  );
}

export interface TaskRowMeta {
  threads: TaskThread[];
  activeThreads: TaskThread[];
}

const ROW_META_BATCH_SIZE = 500;

export function useTaskListMeta(tasks: readonly Task[] | undefined) {
  const taskIds = (tasks ?? []).map((task) => task.id);
  return useTasksQuery<Map<string, TaskRowMeta>>(
    async (rpc) => {
      const map = new Map<string, TaskRowMeta>();
      for (
        let offset = 0;
        offset < taskIds.length;
        offset += ROW_META_BATCH_SIZE
      ) {
        const batch = taskIds.slice(offset, offset + ROW_META_BATCH_SIZE);
        const { rowMeta } = await rpc.call("listTaskRowMeta", {
          taskIds: batch,
        });
        for (const entry of rowMeta) {
          map.set(entry.taskId, {
            threads: entry.threads,
            activeThreads: entry.threads.filter(isActiveThread),
          });
        }
      }
      return map;
    },
    ["threads:changed", "tasks:changed"],
    [taskIds.join()],
  );
}
