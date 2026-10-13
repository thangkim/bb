import { useMemo } from "react";
import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import type { ProjectThread } from "../../shared/contract.js";
import { useProjectThreads } from "../list/data.js";
import { isBusyThread, SideChatLinks } from "./side-chats.js";
import { ThreadLink } from "./thread-link.js";
import { threadDragProps } from "./move-thread.js";
import { useThreadsByRecentActivity } from "./thread-order.js";
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

export function withoutArchivedThreads<T extends { threadId: string }>(
  threads: readonly T[],
  unarchivedThreadIds: ReadonlySet<string> | null,
): readonly T[] {
  if (unarchivedThreadIds === null) return threads;
  const visible = threads.filter((thread) =>
    unarchivedThreadIds.has(thread.threadId),
  );
  return visible.length === threads.length ? threads : visible;
}

interface ProjectThreadLinksProps {
  projectId: string;
  threads: readonly ProjectThread[];
  error: string | null;
  busyThreadIds: ReadonlySet<string>;
  className?: string;
  children?: React.ReactNode;
}

export function ProjectThreadLinks({
  projectId,
  threads,
  error,
  busyThreadIds,
  className,
  children,
}: ProjectThreadLinksProps) {
  const ordered = useThreadsByRecentActivity(threads);
  return (
    <div
      data-project-threads={projectId}
      className={cn("flex flex-col gap-0.5", className)}
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
            {...threadDragProps(thread.threadId, {
              kind: "project",
              projectId,
            })}
          >
            <ThreadLink
              threadId={thread.threadId}
              title={thread.title}
              statusLabel={working ? "Working" : null}
              working={working}
            />
            <SideChatLinks threadId={thread.threadId} />
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
  const attached = threads.data ?? [];
  return (
    <ProjectThreadLinks
      projectId={projectId}
      threads={attached}
      error={threads.error}
      busyThreadIds={busyThreadIds}
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
