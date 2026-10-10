import { useEffect, useMemo, useRef, useState } from "react";
import {
  useSidebarSplitLayout,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { useProjects } from "./data.js";
import { usePersistentPaneWidth } from "./pane-width.js";
import {
  parseTasksRoute,
  useTasksNavigation,
  type ResolvedTasksRoute,
  type TasksNavigation,
  type TasksRoute,
} from "./routes.js";
import { loadViewMode, storeViewMode } from "./view-preference.js";
import { TasksTopbar } from "./topbar.js";
import { ListView } from "../views/list/index.js";
import { BoardView } from "../views/board/index.js";
import { DetailView } from "../views/detail/index.js";
import { ProjectDetailView } from "../views/project/index.js";
import { NewTaskDialog } from "../views/manage/new-task-dialog.js";
import { NewProjectDialog } from "../views/manage/new-project-dialog.js";
import { ManagePanel } from "../views/manage/manage-panel.js";
import { EmptyState } from "../components/empty-state.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { TasksRefreshProvider } from "./refresh.js";
import { ActiveThreadProvider } from "../components/active-thread.js";

const BOARD_MIN_WIDTH = 448;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

function hasOpenOverlay(): boolean {
  return (
    document.querySelector(
      '[role="dialog"], [role="menu"], [role="listbox"]',
    ) !== null
  );
}

function RouteOutlet({
  route,
  boardUsable,
}: {
  route: ResolvedTasksRoute;
  boardUsable: boolean;
}) {
  switch (route.kind) {
    case "all":
    case "active":
      return route.view === "board" && boardUsable ? (
        <BoardView activeOnly={route.kind === "active"} />
      ) : (
        <ListView activeOnly={route.kind === "active"} />
      );
    case "manage":
      return <ManagePanel />;
    case "task":
      return <DetailView taskKey={route.taskKey} />;
    case "project":
      return <ProjectDetailView projectId={route.projectId} />;
  }
}

function resolveRoute(route: TasksRoute): ResolvedTasksRoute {
  switch (route.kind) {
    case "all":
    case "active":
      return { kind: route.kind, view: route.view ?? loadViewMode() };
    default:
      return route;
  }
}

function TasksAppShellContent({ subPath }: PluginNavPanelProps) {
  const route = resolveRoute(parseTasksRoute(subPath));
  const tasksNavigation = useTasksNavigation();
  const navigation = useMemo<TasksNavigation>(
    () => ({
      go: (target, options) => {
        if (
          (target.kind === "all" || target.kind === "active") &&
          target.view !== undefined
        ) {
          storeViewMode(target.view);
        }
        tasksNavigation.go(target, options);
      },
    }),
    [tasksNavigation],
  );
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const openNew = () => {
    if (route.kind === "project") setNewTaskOpen(true);
    else setNewProjectOpen(true);
  };

  const mainRef = useRef<HTMLElement>(null);
  usePersistentPaneWidth(mainRef, useSidebarSplitLayout());
  const [boardUsable, setBoardUsable] = useState(true);
  useEffect(() => {
    const main = mainRef.current;
    if (!main || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const mainWidth = main.clientWidth;
      setBoardUsable(!(mainWidth > 0 && mainWidth < BOARD_MIN_WIDTH));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(main);
    return () => observer.disconnect();
  }, []);
  const projects = useProjects();

  const lastBrowseRouteRef = useRef<TasksRoute | null>(null);
  useEffect(() => {
    if (route.kind !== "task") lastBrowseRouteRef.current = route;
    // oxlint-disable-next-line react/exhaustive-deps
  }, [subPath]);
  const backFromTask = () =>
    navigation.go(lastBrowseRouteRef.current ?? { kind: "all" });
  const onTaskRoute = route.kind === "task";
  const backRef = useRef(backFromTask);
  backRef.current = backFromTask;
  useEffect(() => {
    if (!onTaskRoute) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;
      if (hasOpenOverlay()) return;
      backRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onTaskRoute]);

  const noProjects = projects.data !== undefined && projects.data.length === 0;
  const newTaskProjectId = route.kind === "project" ? route.projectId : null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "c" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (event.defaultPrevented || event.repeat) return;
      if (isEditableTarget(event.target)) return;
      if (hasOpenOverlay()) return;
      event.preventDefault();
      setNewTaskOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="relative flex h-full min-h-0 bg-background text-foreground">
      <main ref={mainRef} className="@container flex min-w-0 flex-1 flex-col">
        <TasksTopbar
          route={route}
          projects={projects.data}
          onNavigate={navigation.go}
          onNew={openNew}
          onBack={backFromTask}
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {noProjects && route.kind !== "task" && route.kind !== "manage" ? (
            <EmptyState
              icon="ListTodo"
              title="No projects yet"
              description="Create a project to start tracking tasks and dispatching work to agents."
              action={
                <Button size="sm" onClick={() => setNewProjectOpen(true)}>
                  <Icon name="Plus" className="size-3.5" />
                  New project
                </Button>
              }
            />
          ) : (
            <ActiveThreadProvider>
              <RouteOutlet route={route} boardUsable={boardUsable} />
            </ActiveThreadProvider>
          )}
        </div>
      </main>
      <NewTaskDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        projectId={newTaskProjectId}
      />
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
      />
    </div>
  );
}

export function TasksAppShell(props: PluginNavPanelProps) {
  return (
    <TasksRefreshProvider>
      <TasksAppShellContent {...props} />
    </TasksRefreshProvider>
  );
}
