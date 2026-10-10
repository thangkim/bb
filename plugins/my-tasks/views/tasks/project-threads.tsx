import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import type { ProjectThread } from "../../shared/contract.js";
import { errorMessage } from "../../shared/errors.js";
import { useTasksRpc } from "../../shell/data.js";
import { useProjectThreads } from "../list/data.js";
import { isBusyThread, SideChatLinks } from "./side-chats.js";
import { ThreadLink } from "./thread-link.js";
import { DropLine, positionBetween, useReorderList } from "./reorder.js";
import { AttachThreadPicker, NewThreadButton } from "./thread-actions.js";
import { cn } from "@/lib/utils";

export function useBusyThreadIds(): ReadonlySet<string> {
  const { threads } = experimental_useSidebarThreads();
  return useMemo(
    () => new Set(threads.filter(isBusyThread).map((thread) => thread.id)),
    [threads],
  );
}

const NO_THREAD_IDS: ReadonlySet<string> = new Set();

export function useUnarchivedThreadIds(): ReadonlySet<string> | null {
  const { status, threads } = experimental_useSidebarThreads();
  return useMemo(() => {
    if (status === "error") return null;
    if (status === "loading") return NO_THREAD_IDS;
    return new Set(threads.map((thread) => thread.id));
  }, [status, threads]);
}

export function withoutArchivedThreads(
  threads: readonly ProjectThread[],
  unarchivedThreadIds: ReadonlySet<string> | null,
): readonly ProjectThread[] {
  if (unarchivedThreadIds === null) return threads;
  const visible = threads.filter((thread) =>
    unarchivedThreadIds.has(thread.threadId),
  );
  return visible.length === threads.length ? threads : visible;
}

interface PositionOverride {
  position: number;
  gen: number;
}

type PositionOverrides = ReadonlyMap<string, PositionOverride>;

export function pruneSettledOverrides(
  overrides: PositionOverrides,
  threads: readonly ProjectThread[],
): PositionOverrides {
  if (overrides.size === 0) return overrides;
  const positions = new Map(
    threads.map((thread) => [thread.id, thread.position]),
  );
  const next = new Map(
    [...overrides].filter(([id, override]) => {
      const position = positions.get(id);
      return position !== undefined && position !== override.position;
    }),
  );
  return next.size === overrides.size ? overrides : next;
}

export function orderedProjectThreads(
  threads: readonly ProjectThread[],
  overrides: PositionOverrides,
): readonly ProjectThread[] {
  if (overrides.size === 0) return threads;
  return threads
    .map((thread) => {
      const override = overrides.get(thread.id);
      return override ? { ...thread, position: override.position } : thread;
    })
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

function useReorderedProjectThreads(
  projectId: string,
  threads: readonly ProjectThread[],
  onError: (message: string) => void,
) {
  const rpc = useTasksRpc();
  const [overrides, setOverrides] = useState<PositionOverrides>(
    () => new Map(),
  );
  const genRef = useRef(0);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    setOverrides((prev) => pruneSettledOverrides(prev, threads));
  }, [threads]);

  const settle = useCallback(
    (id: string, gen: number, position: number | null) => {
      setOverrides((prev) => {
        if (prev.get(id)?.gen !== gen) return prev;
        const next = new Map(prev);
        if (position === null) next.delete(id);
        else next.set(id, { position, gen });
        return pruneSettledOverrides(next, threadsRef.current);
      });
    },
    [],
  );

  const reorder = useCallback(
    (
      thread: ProjectThread,
      before: ProjectThread | undefined,
      after: ProjectThread | undefined,
    ) => {
      const gen = (genRef.current += 1);
      setOverrides((prev) =>
        new Map(prev).set(thread.id, {
          position: positionBetween(before, after),
          gen,
        }),
      );
      void rpc
        .call("reorderProjectThread", {
          projectId,
          threadId: thread.threadId,
          beforeThreadId: before?.threadId ?? null,
          afterThreadId: after?.threadId ?? null,
        })
        .then(
          (result) => settle(thread.id, gen, result.projectThread.position),
          (error: unknown) => {
            settle(thread.id, gen, null);
            onErrorRef.current(errorMessage(error));
          },
        );
    },
    [rpc, projectId, settle],
  );

  const ordered = useMemo(
    () => orderedProjectThreads(threads, overrides),
    [threads, overrides],
  );
  return { ordered, reorder };
}

interface ProjectThreadLinksProps {
  projectId: string;
  threads: readonly ProjectThread[];
  error: string | null;
  busyThreadIds: ReadonlySet<string>;
  onError: (message: string) => void;
  className?: string;
  children?: React.ReactNode;
}

export function ProjectThreadLinks({
  projectId,
  threads,
  error,
  busyThreadIds,
  onError,
  className,
  children,
}: ProjectThreadLinksProps) {
  const { ordered, reorder } = useReorderedProjectThreads(
    projectId,
    threads,
    onError,
  );
  const reorderList = useReorderList<ProjectThread>({
    kind: "project-thread",
    scopeId: projectId,
    items: ordered,
    onReorder: (thread, { before, after }) => reorder(thread, before, after),
  });
  return (
    <div
      data-project-threads={projectId}
      className={cn("flex flex-col gap-0.5", className)}
      {...reorderList.listProps}
    >
      {error !== null ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : null}
      {ordered.map((thread) => {
        const working = busyThreadIds.has(thread.threadId);
        return (
          <div
            key={thread.id}
            data-project-thread-id={thread.threadId}
            className="relative flex flex-col gap-0.5"
            {...reorderList.itemProps(thread)}
          >
            <ThreadLink
              threadId={thread.threadId}
              title={thread.title}
              statusLabel={working ? "Working" : null}
              working={working}
            />
            <SideChatLinks threadId={thread.threadId} />
            <DropLine placement={reorderList.dropPlacement(thread.id)} />
          </div>
        );
      })}
      {children}
    </div>
  );
}

interface ProjectThreadActionsProps {
  projectId: string;
  linked: boolean;
  threads: readonly ProjectThread[];
  onError: (message: string) => void;
  compact?: boolean;
  className?: string;
}

export function ProjectThreadActions({
  projectId,
  linked,
  threads,
  onError,
  compact = false,
  className,
}: ProjectThreadActionsProps) {
  return (
    <div
      data-project-thread-actions={projectId}
      className={cn("flex items-center gap-1", className)}
    >
      <NewThreadButton
        target={{ kind: "project", projectId }}
        projectId={projectId}
        linked={linked}
        onError={onError}
        compact={compact}
      />
      <AttachThreadPicker
        target={{ kind: "project", projectId }}
        attachedThreadIds={threads.map((thread) => thread.threadId)}
        onError={onError}
        compact={compact}
      />
    </div>
  );
}

interface ProjectThreadListProps {
  projectId: string;
  linked: boolean;
  onError: (message: string) => void;
  className?: string;
}

export function ProjectThreadList({
  projectId,
  linked,
  onError,
  className,
}: ProjectThreadListProps) {
  const threads = useProjectThreads(projectId);
  const busyThreadIds = useBusyThreadIds();
  const unarchivedThreadIds = useUnarchivedThreadIds();
  const attached = threads.data ?? [];
  return (
    <ProjectThreadLinks
      projectId={projectId}
      threads={withoutArchivedThreads(attached, unarchivedThreadIds)}
      error={threads.error}
      busyThreadIds={busyThreadIds}
      onError={onError}
      className={className}
    >
      <ProjectThreadActions
        projectId={projectId}
        linked={linked}
        threads={attached}
        onError={onError}
      />
    </ProjectThreadLinks>
  );
}
