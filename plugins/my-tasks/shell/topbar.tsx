import { useCallback, useMemo } from "react";
import type { Project, Task } from "../shared/contract.js";
import { sortItems } from "../shared/sort.js";
import { listAllTasks, useTasksQuery } from "./data.js";
import type { ResolvedTasksRoute, TaskViewMode, TasksRoute } from "./routes.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTasksRefresh } from "./refresh.js";

const REFRESH_TASKS_LABEL = "Refresh tasks";

interface PagerPosition {
  index: number;
  total: number;
  prevKey: string | null;
  nextKey: string | null;
}

export function pagerPosition(
  tasks: readonly Task[],
  taskKey: string,
): PagerPosition | null {
  const ordered = sortItems(tasks, "manual");
  const wanted = taskKey.toUpperCase();
  const index = ordered.findIndex((task) => task.key.toUpperCase() === wanted);
  if (index === -1) return null;
  return {
    index: index + 1,
    total: ordered.length,
    prevKey: ordered[index - 1]?.key ?? null,
    nextKey: ordered[index + 1]?.key ?? null,
  };
}

function TaskPager({
  taskKey,
  projectId,
  onNavigate,
}: {
  taskKey: string;
  projectId: string;
  onNavigate: (route: TasksRoute) => void;
}) {
  const siblings = useTasksQuery(
    async (rpc) => listAllTasks(rpc, { projectId }),
    ["tasks:changed"],
    [projectId],
  );
  const position = useMemo(
    () => (siblings.data ? pagerPosition(siblings.data, taskKey) : null),
    [siblings.data, taskKey],
  );
  if (!position) return null;
  const step = (key: string | null) => {
    if (key !== null) onNavigate({ kind: "task", taskKey: key });
  };
  return (
    <div className="hidden shrink-0 items-center gap-0.5 text-xs tabular-nums text-muted-foreground @sm:flex">
      <span className="hidden px-1 @md:inline">
        {position.index} / {position.total}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 max-md:pointer-coarse:size-9"
        aria-label="Previous task"
        disabled={position.prevKey === null}
        onClick={() => step(position.prevKey)}
      >
        <Icon name="ChevronUp" className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 max-md:pointer-coarse:size-9"
        aria-label="Next task"
        disabled={position.nextKey === null}
        onClick={() => step(position.nextKey)}
      >
        <Icon name="ChevronDown" className="size-3.5" />
      </Button>
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: TaskViewMode;
  onChange: (view: TaskViewMode) => void;
}) {
  const segment = (mode: TaskViewMode, label: string) => (
    <button
      type="button"
      onClick={() => onChange(mode)}
      aria-pressed={view === mode}
      className={cn(
        "rounded-sm px-2.5 py-0.5 text-xs max-md:pointer-coarse:py-1.5",
        view === mode
          ? "bg-background text-foreground shadow-2xs"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center rounded-md bg-muted p-0.5">
      {segment("list", "List")}
      {segment("board", "Board")}
    </div>
  );
}

function RefreshTasksButton() {
  const { refresh, isRefreshing } = useTasksRefresh();

  const handleRefresh = useCallback(() => {
    if (isRefreshing) return;
    refresh();
  }, [isRefreshing, refresh]);

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground active:bg-state-active active:text-foreground max-md:pointer-coarse:size-9"
            aria-label={REFRESH_TASKS_LABEL}
            aria-busy={isRefreshing}
            disabled={isRefreshing}
            onClick={handleRefresh}
          >
            <Icon
              name="RotateCcw"
              className={cn("size-3.5", isRefreshing && "animate-spin")}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{REFRESH_TASKS_LABEL}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface TasksTopbarProps {
  route: ResolvedTasksRoute;
  projects: Project[] | undefined;
  onNavigate: (route: TasksRoute) => void;
  onNew: () => void;
  onBack: () => void;
  className?: string;
}

export function TasksTopbar({
  route,
  projects,
  onNavigate,
  onNew,
  onBack,
  className,
}: TasksTopbarProps) {
  const project = useMemo(() => {
    if (route.kind === "project") {
      return (projects ?? []).find((p) => p.id === route.projectId) ?? null;
    }
    if (route.kind === "task") {
      const prefix = route.taskKey.split("-", 1)[0] ?? "";
      return (projects ?? []).find((p) => p.prefix === prefix) ?? null;
    }
    return null;
  }, [route, projects]);

  const allProjectsCrumb = (
    <button
      type="button"
      className="shrink-0 cursor-pointer whitespace-nowrap text-muted-foreground hover:text-foreground"
      onClick={() => onNavigate({ kind: "all" })}
    >
      All projects
    </button>
  );
  const crumbSeparator = (
    <Icon
      name="ChevronRight"
      aria-hidden
      className="size-3 shrink-0 text-subtle-foreground"
    />
  );

  const breadcrumb = (() => {
    switch (route.kind) {
      case "all":
        return (
          <span className="whitespace-nowrap font-semibold">All projects</span>
        );
      case "active":
        return (
          <span className="flex items-center gap-2">
            <span className="whitespace-nowrap font-semibold">Active</span>
            <span className="hidden text-xs font-normal text-muted-foreground @md:inline">
              agents working now
            </span>
          </span>
        );
      case "manage":
        return (
          <span className="flex items-center gap-2">
            <span className="whitespace-nowrap font-semibold">Manage</span>
            <span className="hidden text-xs font-normal text-muted-foreground @md:inline">
              labels, presets, folders
            </span>
          </span>
        );
      case "project":
        return (
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-1.5"
          >
            {allProjectsCrumb}
            {crumbSeparator}
            <span className="flex min-w-0 items-center gap-2">
              {project ? (
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: project.color }}
                />
              ) : null}
              <span aria-current="page" className="truncate font-semibold">
                {project?.name ?? "Project"}
              </span>
            </span>
          </nav>
        );
      case "task":
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 max-md:pointer-coarse:size-9"
              aria-label="Back (Esc)"
              onClick={onBack}
            >
              <Icon name="ChevronLeft" className="size-4" />
            </Button>
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 items-center gap-1.5"
            >
              {allProjectsCrumb}
              {crumbSeparator}
              {project ? (
                <>
                  <button
                    type="button"
                    className="flex min-w-0 cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      onNavigate({ kind: "project", projectId: project.id })
                    }
                  >
                    <span
                      aria-hidden
                      className="size-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: project.color }}
                    />
                    <span className="truncate font-medium">{project.name}</span>
                  </button>
                  {crumbSeparator}
                </>
              ) : null}
              <span
                aria-current="page"
                className="shrink-0 font-medium text-muted-foreground"
              >
                {route.taskKey}
              </span>
            </nav>
          </span>
        );
    }
  })();

  return (
    <header
      className={cn(
        "flex h-11 shrink-0 items-center gap-2.5 border-b border-border-hairline bg-background px-3.5 text-sm max-md:h-12 max-md:pl-12 max-md:pointer-coarse:pl-14",
        className,
      )}
    >
      <div className="min-w-0 flex-1 overflow-hidden">{breadcrumb}</div>
      {route.kind === "task" && project !== null ? (
        <TaskPager
          taskKey={route.taskKey}
          projectId={project.id}
          onNavigate={onNavigate}
        />
      ) : null}
      {route.kind === "all" || route.kind === "active" ? (
        <span className="hidden @md:block">
          <ViewToggle
            view={route.view}
            onChange={(view) => onNavigate({ kind: route.kind, view })}
          />
        </span>
      ) : null}
      <RefreshTasksButton />
      {route.kind !== "task" && route.kind !== "manage" ? (
        <Button
          size="sm"
          className="h-7 gap-1.5 max-md:pointer-coarse:h-9"
          aria-label={route.kind === "project" ? "New task" : "New project"}
          onClick={onNew}
        >
          <Icon name="Plus" className="size-3.5" />
          <span className="hidden @lg:inline">
            {route.kind === "project" ? "New task" : "New project"}
          </span>
        </Button>
      ) : null}
    </header>
  );
}
