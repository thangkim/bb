import { listAllTasks, useTasksQuery } from "../../shell/data.js";
import type {
  Label,
  Task,
  TaskPriority,
  TaskStatus,
  TaskThread,
} from "../../shared/contract.js";
import { isActiveThread } from "../detail/meta.js";

interface ListTaskFilters {
  statuses: readonly TaskStatus[];
  priorities: readonly TaskPriority[];
  labelIds: readonly string[] | null;
}

export function useListTasks(
  projectId: string | null,
  activeOnly: boolean,
  filters: ListTaskFilters,
) {
  return useTasksQuery(
    async (rpc) =>
      listAllTasks(rpc, {
        ...(projectId === null ? {} : { projectId }),
        ...(filters.statuses.length > 0
          ? { statuses: [...filters.statuses] }
          : {}),
        ...(filters.priorities.length > 0
          ? { priorities: [...filters.priorities] }
          : {}),
        ...(filters.labelIds !== null
          ? { labelIds: [...filters.labelIds] }
          : {}),
        activeOnly,
        parentTaskId: null,
      }),
    ["tasks:changed", "threads:changed"],
    [
      projectId,
      activeOnly,
      filters.statuses.join(),
      filters.priorities.join(),
      filters.labelIds === null ? "" : `active:${filters.labelIds.join()}`,
    ],
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
  subtaskDone: number;
  subtaskTotal: number;
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
            subtaskDone: entry.subtaskDone,
            subtaskTotal: entry.subtaskTotal,
          });
        }
      }
      return map;
    },
    ["threads:changed", "tasks:changed"],
    [taskIds.join()],
  );
}
