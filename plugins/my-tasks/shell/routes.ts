import { useMemo } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";

export const PANEL_PATH = "tasks";

export type TaskViewMode = "list" | "board";

export type ProjectsRouteKind = "all" | "active";

export type TasksRoute =
  | { kind: ProjectsRouteKind; view?: TaskViewMode }
  | { kind: "manage" }
  | { kind: "project"; projectId: string }
  | { kind: "task"; taskKey: string };

export type ResolvedTasksRoute =
  | Exclude<TasksRoute, { kind: ProjectsRouteKind }>
  | { kind: ProjectsRouteKind; view: TaskViewMode };

function parseView(query: string): TaskViewMode | undefined {
  const view = new URLSearchParams(query).get("view");
  return view === "board" || view === "list" ? view : undefined;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseTasksRoute(rawSubPath: string): TasksRoute {
  const subPath = rawSubPath.split("/").map(decodeSegment).join("/");
  const queryIndex = subPath.indexOf("?");
  const path = queryIndex === -1 ? subPath : subPath.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : subPath.slice(queryIndex + 1);
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const head = segments[0];
  const view = parseView(query);
  if (head === undefined || head === "all") {
    return view === undefined ? { kind: "all" } : { kind: "all", view };
  }
  if (head === "active") {
    return view === undefined ? { kind: "active" } : { kind: "active", view };
  }
  if (head === "manage") return { kind: "manage" };
  if (head === "task") {
    const taskKey = segments[1];
    if (taskKey !== undefined) return { kind: "task", taskKey };
    return { kind: "all" };
  }
  return { kind: "project", projectId: head };
}

export function tasksRouteToSubPath(route: TasksRoute): string {
  switch (route.kind) {
    case "all":
    case "active":
      return route.view === undefined
        ? route.kind
        : `${route.kind}?view=${route.view}`;
    case "manage":
      return "manage";
    case "task":
      return `task/${route.taskKey}`;
    case "project":
      return route.projectId;
  }
}

export interface TasksNavigation {
  go: (route: TasksRoute, options?: { replace?: boolean }) => void;
}

export function useTasksNavigation(): TasksNavigation {
  const navigate = useBbNavigate();
  return useMemo(
    () => ({
      go: (route, options) => {
        navigate.toPluginPanel(PANEL_PATH, {
          subPath: tasksRouteToSubPath(route),
          ...(options?.replace ? { replace: true } : {}),
        });
      },
    }),
    [navigate],
  );
}
