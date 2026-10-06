import { useMemo } from "react";
import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import type { ProjectThread } from "../../shared/contract.js";
import { useProjectThreads } from "../list/data.js";
import { ThreadLink } from "./checklist.js";
import { AttachThreadPicker, NewProjectThreadButton } from "./thread-actions.js";
import { cn } from "@/lib/utils";

const BUSY_STATUSES = new Set(["starting", "active", "stopping"]);

export function useBusyThreadIds(): ReadonlySet<string> {
  const { threads } = experimental_useSidebarThreads();
  return useMemo(
    () =>
      new Set(
        threads
          .filter((thread) => BUSY_STATUSES.has(thread.status))
          .map((thread) => thread.id),
      ),
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

const SIDE_CHAT_PLUGIN_ID = "side-chat";

interface SideChat {
  id: string;
  title: string;
}

export function useSideChatsByThread(): ReadonlyMap<
  string,
  readonly SideChat[]
> {
  const { threads } = experimental_useSidebarThreads();
  return useMemo(() => {
    const byParent = new Map<string, SideChat[]>();
    for (const thread of threads) {
      if (
        thread.originKind !== "fork" ||
        thread.originPluginId !== SIDE_CHAT_PLUGIN_ID ||
        thread.sourceThreadId === null
      ) {
        continue;
      }
      const siblings = byParent.get(thread.sourceThreadId) ?? [];
      siblings.push({ id: thread.id, title: thread.displayTitle });
      byParent.set(thread.sourceThreadId, siblings);
    }
    return byParent;
  }, [threads]);
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
  const sideChats = useSideChatsByThread();
  return (
    <div
      data-project-threads={projectId}
      className={cn("flex flex-col gap-0.5", className)}
    >
      {error !== null ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : null}
      {threads.map((thread) => {
        const working = busyThreadIds.has(thread.threadId);
        return (
          <div key={thread.id} className="flex flex-col gap-0.5">
            <ThreadLink
              threadId={thread.threadId}
              title={thread.title}
              statusLabel={working ? "Working" : null}
              working={working}
            />
            {(sideChats.get(thread.threadId) ?? []).map((sideChat) => {
              const sideWorking = busyThreadIds.has(sideChat.id);
              return (
                <div key={sideChat.id} className="flex flex-col pl-4">
                  <ThreadLink
                    threadId={sideChat.id}
                    title={sideChat.title}
                    statusLabel={sideWorking ? "Working" : null}
                    working={sideWorking}
                  />
                </div>
              );
            })}
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
      <NewProjectThreadButton
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
