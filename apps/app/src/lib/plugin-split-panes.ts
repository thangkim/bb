import { useCallback, useMemo } from "react";
import { useStore } from "jotai";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
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
import { rootComposeProjectIdAtomFor } from "./root-compose-selection";
import {
  countPanes,
  findPane,
  listPanes,
  MAX_PANES,
  replacePaneContent,
  setFocus,
  splitPane,
  type ComposeSeed,
  type PaneContent,
} from "./split-layout";
import { maximizedPaneIdAtom, splitLayoutAtom } from "./split-layout/atoms";

let composeIdSequence = 0;

function nextComposeId(): string {
  composeIdSequence += 1;
  return `compose-${Date.now().toString(36)}-${composeIdSequence}`;
}

type JotaiStore = ReturnType<typeof useStore>;

function composeSeedFor(
  options: ExperimentalSplitPaneNewThreadOptions,
  focused: PaneContent | undefined,
  queryClient: QueryClient,
  store: JotaiStore,
): ComposeSeed {
  if (options.projectId !== undefined) {
    return {
      projectId: options.projectId,
      ...(options.environmentId === undefined
        ? {}
        : { environmentId: options.environmentId }),
    };
  }
  if (focused?.kind === "thread") {
    const environmentId = queryClient.getQueryData<ThreadResponse>(
      threadQueryKey(focused.threadId),
    )?.environmentId;
    return {
      projectId: focused.projectId,
      ...(environmentId == null ? {} : { environmentId }),
    };
  }
  const scoped = focused?.kind === "new-thread" ? focused : undefined;
  return {
    projectId: store.get(
      rootComposeProjectIdAtomFor(scoped?.composeId, scoped?.seed?.projectId),
    ),
  };
}

export function useSplitPanes(): ExperimentalSplitPanes {
  const store = useStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const splitWorkspaceActive = useSplitWorkspaceActive();
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
      const seed = composeSeedFor(options, focused, queryClient, store);
      const focusedComposerMatches =
        focused?.kind === "new-thread" &&
        (options.projectId === undefined ||
          store.get(
            rootComposeProjectIdAtomFor(
              focused.composeId,
              focused.seed?.projectId,
            ),
          ) === options.projectId);
      const reused =
        options.reuseComposer !== true
          ? undefined
          : focusedComposerMatches
            ? layout.focusedPaneId
            : listPanes(layout.root).find(
                ({ content }) =>
                  content.kind === "new-thread" &&
                  content.seed?.projectId === seed.projectId &&
                  content.seed.environmentId === seed.environmentId,
              )?.paneId;
      const atCap = countPanes(layout.root) >= MAX_PANES;
      if (reused === undefined && atCap && options.atPaneCap !== "replace") {
        return "at-cap";
      }
      const content: PaneContent = {
        kind: "new-thread",
        composeId: nextComposeId(),
        seed,
      };
      const result: ExperimentalSplitPaneOpenResult =
        reused !== undefined ? "focused" : atCap ? "replaced" : "opened";
      const next =
        reused !== undefined
          ? setFocus(layout, reused)
          : atCap
            ? replacePaneContent(layout, layout.focusedPaneId, content)
            : splitPane(layout, layout.focusedPaneId, options.side, content);
      store.set(splitLayoutAtom, next);
      if (store.get(maximizedPaneIdAtom) !== null) {
        store.set(maximizedPaneIdAtom, next.focusedPaneId);
      }
      const state = {
        ...(options.focusPrompt === false ? {} : { focusPrompt: true }),
        ...(options.sectionId === undefined
          ? {}
          : { sectionId: options.sectionId }),
        ...(options.environmentId === undefined
          ? {}
          : { reuseEnvironmentId: options.environmentId }),
      };
      void navigate(getRootComposeRoutePath(), {
        replace: result === "focused",
        state: Object.keys(state).length > 0 ? state : null,
      });
      return result;
    },
    [navigate, pathname, queryClient, splitWorkspaceActive, store],
  );

  return useMemo(
    () => ({ isAvailable, openNewThread }),
    [isAvailable, openNewThread],
  );
}
