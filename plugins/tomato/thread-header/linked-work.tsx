import type { PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { Project, Task } from "../shared/contract.js";
import { useTasksQuery } from "../shell/data.js";
import { TasksRefreshProvider } from "../shell/refresh.js";
import { priorityTextClassName } from "../views/list/icons.js";
import { openThreadLinks } from "../thread-links/store.js";
import { beginPointerThreadDrag } from "../views/tasks/move-thread.js";

type LinkedWork =
  | { kind: "task"; task: Task; project: Project | null; extra: number }
  | { kind: "project"; project: Project; extra: number };

export function resolveLinkedWork(links: {
  tasks: readonly Task[];
  projects: readonly Project[];
}): LinkedWork | null {
  const [task, ...otherTasks] = links.tasks;
  if (task !== undefined) {
    return { kind: "task", task, project: null, extra: otherTasks.length };
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
      const work = resolveLinkedWork(result);
      if (work?.kind !== "task") return { threadId, work };
      const { projects } = await rpc.call("listProjects", {});
      const project =
        projects.find(({ id }) => id === work.task.projectId) ?? null;
      return { threadId, work: { ...work, project } };
    },
    ["tasks:changed", "projects:changed", "threads:changed"],
    [threadId],
  );
  const work = links.data?.threadId === threadId ? links.data.work : null;
  if (work === null) return null;

  const displayProject = work.project;
  const label =
    displayProject?.name ?? (work.kind === "task" ? work.task.title : "");
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
      title={`${fullTitle} — click to change, drag to split or onto a task or project to move`}
      data-linked-work-kind={work.kind}
      data-linked-work-label={label}
      data-linked-work-color={displayProject?.color}
      onClick={() => openThreadLinks({ threadId, projectId })}
      onPointerDown={(event) =>
        beginPointerThreadDrag(
          event.nativeEvent,
          threadId,
          work.kind === "task"
            ? { kind: "task", taskId: work.task.id }
            : { kind: "project", projectId: work.project.id },
        )
      }
      className={cn(
        "flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        isCompactViewport && "px-2",
      )}
    >
      {isCompactViewport ? (
        <Icon name="ListTodo" className="size-3.5 shrink-0" />
      ) : (
        <>
          <span
            aria-hidden
            className={cn(
              "min-w-0 truncate",
              displayProject !== null &&
                priorityTextClassName(displayProject.priority),
            )}
          >
            {label}
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
