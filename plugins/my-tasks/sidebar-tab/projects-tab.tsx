import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import { useTasksNavigation, type TasksRoute } from "../shell/routes.js";
import { TasksRefreshProvider } from "../shell/refresh.js";
import { TasksTopbar } from "../shell/topbar.js";
import { ListView } from "../views/list/index.js";
import { NewProjectDialog } from "../views/manage/new-project-dialog.js";
import { ActiveThreadProvider } from "../components/active-thread.js";

export const PROJECTS_PANEL_SELECTOR = '[data-sidebar-tab-panel="projects"]';

export const PANELS_CHANGED_EVENT = "bb:sidebar-tab-panels";

const SIDEBAR_SURFACE = { "--background": "var(--sidebar)" } as CSSProperties;

export function findProjectsPanels(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(PROJECTS_PANEL_SELECTOR)];
}

function useProjectsPanels(): HTMLElement[] {
  const [panels, setPanels] = useState<HTMLElement[]>(() =>
    findProjectsPanels(document),
  );
  useEffect(() => {
    const update = () => {
      const next = findProjectsPanels(document);
      setPanels((current) =>
        current.length === next.length &&
        current.every((panel, index) => panel === next[index])
          ? current
          : next,
      );
    };
    update();
    window.addEventListener(PANELS_CHANGED_EVENT, update);
    return () => window.removeEventListener(PANELS_CHANGED_EVENT, update);
  }, []);
  return panels;
}

const ALL_PROJECTS = { kind: "all", view: "list" } as const;

function SidebarProjects() {
  const tasksNavigation = useTasksNavigation();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const navigate = (route: TasksRoute) => {
    if (route.kind === "all") return;
    tasksNavigation.go(route);
  };
  return (
    <div
      className="@container flex min-h-0 flex-1 flex-col bg-background text-foreground"
      style={SIDEBAR_SURFACE}
    >
      <TasksTopbar
        route={ALL_PROJECTS}
        projects={undefined}
        onNavigate={navigate}
        onNew={() => setNewProjectOpen(true)}
        onBack={() => {}}
        className="max-md:pl-3.5 max-md:pointer-coarse:pl-3.5"
      />
      <div className="min-h-0 flex-1">
        <ActiveThreadProvider>
          <ListView />
        </ActiveThreadProvider>
      </div>
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
      />
    </div>
  );
}

export function SidebarProjectsTab() {
  const pluginId = experimental_usePluginId();
  const panels = useProjectsPanels();
  return panels.map((panel, index) =>
    createPortal(
      <div
        data-bb-plugin-root=""
        data-bb-plugin={pluginId}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TasksRefreshProvider>
          <SidebarProjects />
        </TasksRefreshProvider>
      </div>,
      panel,
      `sidebar-projects-${index}`,
    ),
  );
}
