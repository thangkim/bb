import type { PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { Project, Task } from "../shared/contract.js";
import { useTasksQuery } from "../shell/data.js";
import { TasksRefreshProvider } from "../shell/refresh.js";
import { openThreadLinks } from "../thread-links/store.js";

type LinkedWork =
  | { kind: "task"; task: Task; extra: number }
  | { kind: "project"; project: Project; extra: number };

export function resolveLinkedWork(links: {
  tasks: readonly Task[];
  projects: readonly Project[];
}): LinkedWork | null {
  const [task, ...otherTasks] = links.tasks;
  if (task !== undefined) {
    return { kind: "task", task, extra: otherTasks.length };
  }
  const [project, ...otherProjects] = links.projects;
  if (project !== undefined) {
    return { kind: "project", project, extra: otherProjects.length };
  }
  return null;
}

function LinkedWorkBadge({
  threadId,
  projectId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const links = useTasksQuery(
    async (rpc) => {
      const result = await rpc.call("listThreadLinks", { threadId });
      return { threadId, work: resolveLinkedWork(result) };
    },
    ["tasks:changed", "projects:changed", "threads:changed"],
    [threadId],
  );
  const work = links.data?.threadId === threadId ? links.data.work : null;
  if (work === null) return null;

  const extraLabel = work.extra > 0 ? `+${work.extra}` : null;
  const ariaLabel =
    work.kind === "task"
      ? `Task ${work.task.key}: ${work.task.title}`
      : `Project ${work.project.name}`;
  const fullTitle =
    extraLabel === null ? ariaLabel : `${ariaLabel} (${work.extra} more)`;

  return (
    <button
      type="button"
      aria-label={fullTitle}
      aria-haspopup="dialog"
      title={`${fullTitle} — click to change`}
      data-linked-work-kind={work.kind}
      data-linked-work-label={
        work.kind === "task" ? work.task.title : work.project.name
      }
      data-linked-work-color={
        work.kind === "project" ? work.project.color : undefined
      }
      onClick={() => openThreadLinks({ threadId, projectId })}
      className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {work.kind === "project" ? (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: work.project.color }}
        />
      ) : isCompactViewport ? (
        <Icon name="ListTodo" className="size-3.5 shrink-0" />
      ) : null}
      {isCompactViewport ? null : (
        <>
          <span
            aria-hidden
            className={cn(
              "min-w-0 truncate",
              work.kind === "task" && "text-timeline-accent",
            )}
          >
            {work.kind === "task" ? work.task.title : work.project.name}
          </span>
          {extraLabel === null ? null : (
            <span aria-hidden className="shrink-0">
              {extraLabel}
            </span>
          )}
        </>
      )}
    </button>
  );
}

export function ThreadLinkedWork(props: PluginThreadHeaderActionProps) {
  return (
    <TasksRefreshProvider>
      <LinkedWorkBadge {...props} />
    </TasksRefreshProvider>
  );
}
