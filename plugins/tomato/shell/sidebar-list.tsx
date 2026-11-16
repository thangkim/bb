import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { useProjects } from "./data.js";
import { TasksRefreshProvider } from "./refresh.js";
import {
  TasksNavigationProvider,
  type ResolvedTasksRoute,
  type TasksNavigation,
  type TasksRoute,
} from "./routes.js";
import { storeViewMode } from "./view-preference.js";
import { TasksTopbar } from "./topbar.js";
import { TopbarSlotProvider } from "./topbar-slot.js";
import { RouteOutlet } from "./app-shell.js";
import { NewProjectDialog } from "../views/manage/new-project-dialog.js";
import { NewTaskDialog } from "../views/manage/new-task-dialog.js";
import { ActiveThreadProvider } from "../components/active-thread.js";

const LIST_ROUTE: ResolvedTasksRoute = { kind: "all", view: "list" };

function resolveSidebarRoute(route: TasksRoute): ResolvedTasksRoute {
  switch (route.kind) {
    case "all":
    case "active":
      return { kind: route.kind, view: "list" };
    default:
      return route;
  }
}

const LIST_ROOT_ATTRIBUTE = "data-tomato-sidebar-list";

const SIDEBAR_CHROME_CSS = [
  '[data-testid="sidebar-header-slot"], [data-sidebar-header-slot] { display: none !important; }',
  `[data-testid="app-sidebar-body"] > div:has(> [${LIST_ROOT_ATTRIBUTE}]) { overflow: hidden !important; scrollbar-gutter: auto !important; }`,
].join("\n");

function useHiddenSidebarHeaderSlot(): void {
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = SIDEBAR_CHROME_CSS;
    document.head.append(style);
    return () => style.remove();
  }, []);
}

const TOP_ROW_SELECTOR = '[data-testid="app-sidebar-top-reserve-row"]';

function useTopRowHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const row = document.querySelector<HTMLElement>(TOP_ROW_SELECTOR);
    if (row === null) return;
    const element = document.createElement("div");
    element.className = "flex h-full min-w-0 flex-1 items-center";
    row.prepend(element);
    setHost(element);
    return () => {
      element.remove();
      setHost(null);
    };
  }, []);
  return host;
}

function TasksSidebarListContent() {
  useHiddenSidebarHeaderSlot();
  const topRow = useTopRowHost();
  const projects = useProjects();
  const [route, setRoute] = useState<ResolvedTasksRoute>(LIST_ROUTE);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const navigation = useMemo<TasksNavigation>(
    () => ({
      go: (target) => {
        if (
          (target.kind === "all" || target.kind === "active") &&
          target.view !== undefined
        ) {
          storeViewMode(target.view);
        }
        setRoute(resolveSidebarRoute(target));
      },
    }),
    [],
  );

  return (
    <TasksNavigationProvider value={navigation}>
      <div
        {...{ [LIST_ROOT_ATTRIBUTE]: "" }}
        className="@container flex h-full min-h-0 min-w-0 flex-1 flex-col text-foreground"
      >
        {topRow === null
          ? null
          : createPortal(
              <TasksTopbar
                route={route}
                projects={projects.data}
                onNavigate={navigation.go}
                onNew={() =>
                  route.kind === "project"
                    ? setNewTaskOpen(true)
                    : setNewProjectOpen(true)
                }
                className="h-full flex-1 border-b-0 bg-transparent px-1.5"
              />,
              topRow,
            )}
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <ActiveThreadProvider>
            <RouteOutlet route={route} boardUsable={false} />
          </ActiveThreadProvider>
        </div>
        <NewProjectDialog
          open={newProjectOpen}
          onOpenChange={setNewProjectOpen}
        />
        <NewTaskDialog
          open={newTaskOpen}
          onOpenChange={setNewTaskOpen}
          projectId={route.kind === "project" ? route.projectId : null}
        />
      </div>
    </TasksNavigationProvider>
  );
}

export function TasksSidebarList(_props: PluginThreadListProps) {
  return (
    <TasksRefreshProvider>
      <TopbarSlotProvider>
        <TasksSidebarListContent />
      </TopbarSlotProvider>
    </TasksRefreshProvider>
  );
}
