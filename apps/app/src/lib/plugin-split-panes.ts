import { useCallback, useMemo } from "react";
import { useStore } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import type {
  ExperimentalSplitPaneNewThreadOptions,
  ExperimentalSplitPaneOpenResult,
  ExperimentalSplitPanes,
} from "@get-bb/plugin-sdk";
import type { ThreadResponse } from "@bb/server-contract";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { useSplitWorkspaceActive } from "@/hooks/useSplitWorkspaceActive";
import {
  paneContentForPathname,
  reconcileLayoutForContent,
} from "@/views/thread-detail/splitThreadNavigation";
import { getRootComposeRoutePath } from "./route-paths";
import { useSetRootComposeProjectId } from "./root-compose-selection";
import {
  countPanes,
  findPane,
  findPaneByContent,
  MAX_PANES,
  replacePaneContent,
  setFocus,
  splitPane,
  type PaneContent,
} from "./split-layout";
import { maximizedPaneIdAtom, splitLayoutAtom } from "./split-layout/atoms";

const NEW_THREAD_CONTENT: PaneContent = { kind: "new-thread" };

export function useSplitPanes(): ExperimentalSplitPanes {
  const store = useStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const splitWorkspaceActive = useSplitWorkspaceActive();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const isAvailable =
    splitWorkspaceActive && paneContentForPathname(pathname) !== null;

  const openNewThread = useCallback(
    (
      options: ExperimentalSplitPaneNewThreadOptions,
    ): ExperimentalSplitPaneOpenResult => {
      const routeContent = paneContentForPathname(pathname);
      if (!splitWorkspaceActive || routeContent === null) return "unavailable";
      const layout =
        store.get(splitLayoutAtom) ??
        reconcileLayoutForContent(null, routeContent);
      const focused = findPane(layout.root, layout.focusedPaneId)?.content;
      const focusedThread = focused?.kind === "thread" ? focused : null;
      const projectId = options.projectId ?? focusedThread?.projectId;
      const environmentId =
        options.projectId === undefined && focusedThread !== null
          ? (queryClient.getQueryData<ThreadResponse>(
              threadQueryKey(focusedThread.threadId),
            )?.environmentId ?? null)
          : null;
      const existing = findPaneByContent(layout.root, NEW_THREAD_CONTENT);
      const atCap = countPanes(layout.root) >= MAX_PANES;
      if (existing === null && atCap && options.atPaneCap !== "replace") {
        return "at-cap";
      }
      const result: ExperimentalSplitPaneOpenResult =
        existing !== null ? "focused" : atCap ? "replaced" : "opened";
      const next =
        existing !== null
          ? setFocus(layout, existing.paneId)
          : atCap
            ? replacePaneContent(
                layout,
                layout.focusedPaneId,
                NEW_THREAD_CONTENT,
              )
            : splitPane(
                layout,
                layout.focusedPaneId,
                options.side,
                NEW_THREAD_CONTENT,
              );
      store.set(splitLayoutAtom, next);
      if (store.get(maximizedPaneIdAtom) !== null) {
        store.set(maximizedPaneIdAtom, next.focusedPaneId);
      }
      if (projectId !== undefined) setRootComposeProjectId(projectId);
      void navigate(getRootComposeRoutePath(), {
        replace: result === "focused",
        state: {
          ...(options.focusPrompt === false ? {} : { focusPrompt: true }),
          ...(environmentId === null
            ? {}
            : { reuseEnvironmentId: environmentId }),
        },
      });
      return result;
    },
    [
      navigate,
      pathname,
      queryClient,
      setRootComposeProjectId,
      splitWorkspaceActive,
      store,
    ],
  );

  return useMemo(
    () => ({ isAvailable, openNewThread }),
    [isAvailable, openNewThread],
  );
}
