import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  experimental_useSidebarThreads,
  useBbContext,
  useSidebarSplitLayout,
  type PluginSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";
import { isSideChatShapedThread } from "../shared/side-chat.js";
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

function useLinkedThreadId(threadId: string | null): string | null {
  const { threads } = experimental_useSidebarThreads();
  return useMemo(() => {
    if (threadId === null) return null;
    const thread = threads.find((candidate) => candidate.id === threadId);
    if (
      thread === undefined ||
      thread.sourceThreadId === null ||
      !isSideChatShapedThread({
        originKind: thread.originKind,
        originPluginId: thread.originPluginId,
        visibility: thread.isHidden ? "hidden" : "visible",
      })
    ) {
      return threadId;
    }
    return thread.sourceThreadId;
  }, [threadId, threads]);
}

export function ActiveThreadProvider({ children }: { children: ReactNode }) {
  const threadId = useActiveThreadId();
  const linkedThreadId = useLinkedThreadId(threadId);
  const links = useTasksQuery(
    async (rpc) => {
      if (linkedThreadId === null) return null;
      const result = await rpc.call("listThreadLinks", {
        threadId: linkedThreadId,
      });
      return {
        linkedThreadId,
        projectIds: new Set([
          ...result.projects.map((project) => project.id),
          ...result.tasks.map((task) => task.projectId),
        ]),
        taskIds: new Set(result.tasks.map((task) => task.id)),
      };
    },
    ["tasks:changed", "projects:changed", "threads:changed"],
    [linkedThreadId],
  );
  const value = useMemo<ActiveThreadLinks>(() => {
    if (threadId === null) return NO_ACTIVE_THREAD;
    const data = links.data;
    if (!data || data.linkedThreadId !== linkedThreadId) {
      return { ...NO_ACTIVE_THREAD, threadId };
    }
    return { threadId, projectIds: data.projectIds, taskIds: data.taskIds };
  }, [threadId, linkedThreadId, links.data]);
  return (
    <ActiveThreadContext.Provider value={value}>
      {children}
    </ActiveThreadContext.Provider>
  );
}

export function useActiveThread(): ActiveThreadLinks {
  return useContext(ActiveThreadContext);
}
