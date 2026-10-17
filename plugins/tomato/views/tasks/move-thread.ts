import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { DelegationRpcContract } from "../../delegate/contract.js";
import { errorMessage } from "../../shared/errors.js";

export const THREAD_DRAG_TYPE = "application/x-tomato-thread";
export const THREAD_DROP_OWNER_ATTR = "data-thread-drop-owner";
const POINTER_DRAG_ENGAGE_PX = 7;

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

function ownerKey(owner: ThreadOwner): string {
  return owner.kind === "task"
    ? `task:${owner.taskId}`
    : `project:${owner.projectId}`;
}

type PointerDropHandler = (dragged: DraggedThread) => void;

const pointerDropHandlers = new Map<string, Set<PointerDropHandler>>();
const pointerHoverListeners = new Set<() => void>();
let pointerHoverKey: string | null = null;

function setPointerHoverKey(key: string | null) {
  if (key === pointerHoverKey) return;
  pointerHoverKey = key;
  for (const listener of pointerHoverListeners) listener();
}

function subscribePointerHover(listener: () => void) {
  pointerHoverListeners.add(listener);
  return () => {
    pointerHoverListeners.delete(listener);
  };
}

function pointerDropKeyAt(x: number, y: number): string | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const target = element.closest(`[${THREAD_DROP_OWNER_ATTR}]`);
    const key = target?.getAttribute(THREAD_DROP_OWNER_ATTR);
    if (key) return key;
  }
  return null;
}

function hostSplitOverlay(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>("[data-split-drag-label]")
      ?.parentElement ?? null
  );
}

function forwardToPaneTitle(event: PointerEvent) {
  if (!(event.target instanceof Element)) return;
  const title = event.target
    .closest("[data-split-pane-id]")
    ?.querySelector<HTMLElement>("header p.cursor-grab");
  if (!title) return;
  title.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: event.button,
      buttons: event.buttons,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      isPrimary: event.isPrimary,
    }),
  );
}

export function beginPointerThreadDrag(
  event: PointerEvent,
  threadId: string,
  from: ThreadOwner,
) {
  if (event.button !== 0) return;
  forwardToPaneTitle(event);
  const fromKey = ownerKey(from);
  const startX = event.clientX;
  const startY = event.clientY;
  let engaged = false;

  const finish = () => {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", finish, true);
    window.removeEventListener("keydown", onKeyDown, true);
    const overlay = hostSplitOverlay();
    if (overlay) overlay.style.visibility = "";
    setPointerHoverKey(null);
  };
  const onMove = (move: PointerEvent) => {
    if (!engaged) {
      engaged =
        Math.hypot(move.clientX - startX, move.clientY - startY) >
        POINTER_DRAG_ENGAGE_PX;
      if (!engaged) return;
    }
    const key = pointerDropKeyAt(move.clientX, move.clientY);
    const target = key === fromKey ? null : key;
    setPointerHoverKey(target);
    const overlay = hostSplitOverlay();
    if (overlay) overlay.style.visibility = target === null ? "" : "hidden";
  };
  const onUp = () => {
    const key = pointerHoverKey;
    finish();
    if (key === null) return;
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
      }),
    );
    const handler = pointerDropHandlers.get(key)?.values().next().value;
    handler?.({ threadId, from });
  };
  const onKeyDown = (keydown: KeyboardEvent) => {
    if (keydown.code === "Escape") finish();
  };
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", finish, true);
  window.addEventListener("keydown", onKeyDown, true);
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
  const [nativeOver, setOver] = useState(false);
  const key = ownerKey(to);
  const pointerOver = useSyncExternalStore(
    subscribePointerHover,
    () => pointerHoverKey === key,
  );
  const over = nativeOver || pointerOver;
  const toKind = to.kind;
  const toId = to.kind === "task" ? to.taskId : to.projectId;
  useEffect(() => {
    const target: ThreadOwner =
      toKind === "task"
        ? { kind: "task", taskId: toId }
        : { kind: "project", projectId: toId };
    const handler: PointerDropHandler = (dragged) => {
      void moveThread(dragged, target);
    };
    const handlers = pointerDropHandlers.get(key) ?? new Set();
    handlers.add(handler);
    pointerDropHandlers.set(key, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) pointerDropHandlers.delete(key);
    };
  }, [key, toKind, toId, moveThread]);
  useEffect(() => {
    if (!nativeOver) return;
    const reset = () => setOver(false);
    window.addEventListener("dragend", reset);
    return () => window.removeEventListener("dragend", reset);
  }, [nativeOver]);
  const props = {
    [THREAD_DROP_OWNER_ATTR]: key,
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
