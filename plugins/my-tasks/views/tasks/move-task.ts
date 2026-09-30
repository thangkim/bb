import { useCallback } from "react";
import { errorMessage } from "../../shared/errors.js";
import { useTasksRpc } from "../../shell/data.js";

export const PROJECT_DRAG_TYPE = "application/x-my-tasks-project";
export const TASK_DRAG_TYPE = "application/x-my-tasks-task";

interface DraggedTask {
  taskId: string;
  projectId: string;
}

export function writeDraggedTask(
  dataTransfer: DataTransfer,
  task: DraggedTask,
): void {
  dataTransfer.setData(TASK_DRAG_TYPE, JSON.stringify(task));
  dataTransfer.effectAllowed = "move";
}

export function isTaskDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types ?? []).includes(TASK_DRAG_TYPE);
}

export function readDraggedTask(dataTransfer: DataTransfer): DraggedTask | null {
  const raw = dataTransfer.getData(TASK_DRAG_TYPE);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "taskId" in parsed &&
      "projectId" in parsed &&
      typeof parsed.taskId === "string" &&
      typeof parsed.projectId === "string"
    ) {
      return { taskId: parsed.taskId, projectId: parsed.projectId };
    }
  } catch {}
  return null;
}

export function useMoveTaskToProject(onError: (message: string) => void) {
  const rpc = useTasksRpc();
  return useCallback(
    (taskId: string, projectId: string) => {
      void rpc.call("moveTaskToProject", { taskId, projectId }).then(
        (result) => {
          if (!result.ok) onError(result.error.message);
        },
        (error: unknown) => onError(errorMessage(error)),
      );
    },
    [rpc, onError],
  );
}
