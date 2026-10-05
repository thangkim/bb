import { useMemo } from "react";
import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import type { Preset, ProjectThread } from "../../shared/contract.js";
import { useProjectThreads } from "../list/data.js";
import { ThreadLink } from "./checklist.js";
import { AttachThreadPicker, NewThreadMenu } from "./thread-actions.js";
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
          <ThreadLink
            key={thread.id}
            threadId={thread.threadId}
            title={thread.title}
            statusLabel={working ? "Working" : null}
            working={working}
          />
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
  presets: Preset[] | undefined;
  onError: (message: string) => void;
  compact?: boolean;
  className?: string;
}

export function ProjectThreadActions({
  projectId,
  linked,
  threads,
  presets,
  onError,
  compact = false,
  className,
}: ProjectThreadActionsProps) {
  return (
    <div
      data-project-thread-actions={projectId}
      className={cn("flex items-center gap-1", className)}
    >
      <NewThreadMenu
        target={{ kind: "project", projectId }}
        presets={presets}
        onError={onError}
        compact={compact}
        unlinkedProjectId={linked ? null : projectId}
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
  presets: Preset[] | undefined;
  onError: (message: string) => void;
  className?: string;
}

export function ProjectThreadList({
  projectId,
  linked,
  presets,
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
        presets={presets}
        onError={onError}
      />
    </ProjectThreadLinks>
  );
}
