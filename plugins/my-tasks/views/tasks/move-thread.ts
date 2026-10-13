import { useCallback, useEffect, useState, type DragEvent } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { DelegationRpcContract } from "../../delegate/contract.js";
import { errorMessage } from "../../shared/errors.js";

export const THREAD_DRAG_TYPE = "application/x-my-tasks-thread";

export type ThreadOwner =
  | { kind: "task"; taskId: string }
  | { kind: "project"; projectId: string };

interface DraggedThread {
  threadId: string;
  from: ThreadOwner;
}

export function isThreadDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types ?? []).includes(THREAD_DRAG_TYPE);
}

function parseOwner(value: unknown): ThreadOwner | null {
  if (value === null || typeof value !== "object" || !("kind" in value)) {
    return null;
  }
  if (
    value.kind === "task" &&
    "taskId" in value &&
    typeof value.taskId === "string"
  ) {
    return { kind: "task", taskId: value.taskId };
  }
  if (
    value.kind === "project" &&
    "projectId" in value &&
    typeof value.projectId === "string"
  ) {
    return { kind: "project", projectId: value.projectId };
  }
  return null;
}

export function readDraggedThread(
  dataTransfer: DataTransfer,
): DraggedThread | null {
  const raw = dataTransfer.getData(THREAD_DRAG_TYPE);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !("threadId" in parsed) ||
      typeof parsed.threadId !== "string" ||
      !("from" in parsed)
    ) {
      return null;
    }
    const from = parseOwner(parsed.from);
    return from === null ? null : { threadId: parsed.threadId, from };
  } catch {}
  return null;
}

function sameOwner(a: ThreadOwner, b: ThreadOwner): boolean {
  return a.kind === "task"
    ? b.kind === "task" && a.taskId === b.taskId
    : b.kind === "project" && a.projectId === b.projectId;
}

export function threadDragProps(threadId: string, from: ThreadOwner) {
  return {
    draggable: true as const,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.stopPropagation();
      event.dataTransfer.setData(
        THREAD_DRAG_TYPE,
        JSON.stringify({ threadId, from }),
      );
      event.dataTransfer.effectAllowed = "move";
    },
  };
}

export function useMoveThread(onError: (message: string) => void) {
  const rpc = useRpc<DelegationRpcContract>();
  return useCallback(
    async (dragged: DraggedThread, to: ThreadOwner) => {
      if (sameOwner(dragged.from, to)) return;
      const { threadId, from } = dragged;
      try {
        if (to.kind === "task") {
          await rpc.call("taskThreadsAttach", { taskId: to.taskId, threadId });
        } else {
          await rpc.call("projectThreadsAttach", {
            projectId: to.projectId,
            threadId,
          });
        }
        if (from.kind === "task") {
          await rpc.call("taskThreadsDetach", {
            taskId: from.taskId,
            threadId,
          });
        } else {
          await rpc.call("projectThreadsDetach", {
            projectId: from.projectId,
            threadId,
          });
        }
      } catch (error) {
        onError(errorMessage(error));
      }
    },
    [rpc, onError],
  );
}

const claimedDrops = new WeakSet<Event>();

export function useThreadDropTarget(
  to: ThreadOwner,
  onError: (message: string) => void,
) {
  const moveThread = useMoveThread(onError);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!over) return;
    const reset = () => setOver(false);
    window.addEventListener("dragend", reset);
    return () => window.removeEventListener("dragend", reset);
  }, [over]);
  const props = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!isThreadDrag(event.dataTransfer)) return;
      if (claimedDrops.has(event.nativeEvent)) {
        setOver(false);
        return;
      }
      claimedDrops.add(event.nativeEvent);
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setOver(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      setOver(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      setOver(false);
      if (claimedDrops.has(event.nativeEvent)) return;
      const dragged = readDraggedThread(event.dataTransfer);
      if (dragged === null) return;
      claimedDrops.add(event.nativeEvent);
      event.preventDefault();
      void moveThread(dragged, to);
    },
  };
  return { over, props };
}
