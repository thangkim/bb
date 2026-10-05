import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  useBbContext,
  useSidebarSplitLayout,
  type PluginSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";
import { useTasksQuery } from "../shell/data.js";

export interface ActiveThreadLinks {
  threadId: string | null;
  projectIds: ReadonlySet<string>;
  taskIds: ReadonlySet<string>;
}

const NO_ACTIVE_THREAD: ActiveThreadLinks = {
  threadId: null,
  projectIds: new Set(),
  taskIds: new Set(),
};

const ActiveThreadContext = createContext<ActiveThreadLinks>(NO_ACTIVE_THREAD);

export function resolveActiveThreadId(
  layout: PluginSidebarSplitLayout | null,
  routeThreadId: string | null,
  lastFocusedThreadId: string | null,
): string | null {
  if (layout === null) return routeThreadId;
  const focused = layout.panes.find((pane) => pane.isFocused)?.threadId;
  if (focused) return focused;
  const openThreadIds = layout.panes.flatMap((pane) =>
    pane.threadId === null ? [] : [pane.threadId],
  );
  if (
    lastFocusedThreadId !== null &&
    openThreadIds.includes(lastFocusedThreadId)
  ) {
    return lastFocusedThreadId;
  }
  return openThreadIds.length === 1 ? openThreadIds[0]! : null;
}

function useActiveThreadId(): string | null {
  const layout = useSidebarSplitLayout();
  const { threadId: routeThreadId } = useBbContext();
  const focused =
    layout?.panes.find((pane) => pane.isFocused)?.threadId ?? null;
  const [lastFocused, setLastFocused] = useState<string | null>(focused);
  if (focused !== null && focused !== lastFocused) setLastFocused(focused);
  return resolveActiveThreadId(layout, routeThreadId, lastFocused);
}

export function ActiveThreadProvider({ children }: { children: ReactNode }) {
  const threadId = useActiveThreadId();
  const links = useTasksQuery(
    async (rpc) => {
      if (threadId === null) return null;
      const result = await rpc.call("listThreadLinks", { threadId });
      return {
        threadId,
        projectIds: new Set([
          ...result.projects.map((project) => project.id),
          ...result.tasks.map((task) => task.projectId),
        ]),
        taskIds: new Set(result.tasks.map((task) => task.id)),
      };
    },
    ["tasks:changed", "projects:changed", "threads:changed"],
    [threadId],
  );
  const value = useMemo<ActiveThreadLinks>(() => {
    if (threadId === null) return NO_ACTIVE_THREAD;
    const data = links.data;
    if (!data || data.threadId !== threadId) {
      return { ...NO_ACTIVE_THREAD, threadId };
    }
    return data;
  }, [threadId, links.data]);
  return (
    <ActiveThreadContext.Provider value={value}>
      {children}
    </ActiveThreadContext.Provider>
  );
}

export function useActiveThread(): ActiveThreadLinks {
  return useContext(ActiveThreadContext);
}
