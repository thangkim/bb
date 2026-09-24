import { useCallback } from "react";
import { useStore } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import {
  defaultRootComposeProjectIdAtom,
  useSetRootComposeProjectId,
} from "@/lib/root-compose-selection";
import { findPane } from "@/lib/split-layout";
import { maximizedPaneIdAtom, splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  composeSeedForPaneContent,
  openNewThreadBesideFocusedPane,
} from "@/views/thread-detail/newThreadPane";
import {
  paneContentForPathname,
  reconcileLayoutForContent,
} from "@/views/thread-detail/splitThreadNavigation";

export interface OpenNewThreadPaneOptions {
  projectId?: string | undefined;
  onNavigate?: (() => void) | undefined;
}

export function useOpenNewThreadPane(): (
  options?: OpenNewThreadPaneOptions,
) => void {
  const store = useStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isCompactViewport = useIsCompactViewport();
  const setRootComposeProjectId = useSetRootComposeProjectId();

  return useCallback(
    (options?: OpenNewThreadPaneOptions) => {
      options?.onNavigate?.();
      const route = getRootComposeRoutePath();
      const navigateOptions = { state: { focusPrompt: true } };
      const routeContent = paneContentForPathname(pathname);
      const stored = store.get(splitLayoutAtom);
      const layout =
        stored === null && routeContent !== null
          ? reconcileLayoutForContent(null, routeContent)
          : stored;
      if (isCompactViewport || layout === null) {
        if (options?.projectId !== undefined) {
          setRootComposeProjectId(options.projectId);
        }
        void navigate(route, navigateOptions);
        return;
      }
      const focused =
        routeContent === null
          ? null
          : findPane(layout.root, layout.focusedPaneId);
      const seed = (focused === null
        ? null
        : composeSeedForPaneContent(focused.content, queryClient)) ?? {
        projectId:
          options?.projectId ?? store.get(defaultRootComposeProjectIdAtom),
      };
      const next = openNewThreadBesideFocusedPane(layout, seed);
      if (next !== stored) store.set(splitLayoutAtom, next);
      if (store.get(maximizedPaneIdAtom) !== null) {
        store.set(maximizedPaneIdAtom, next.focusedPaneId);
      }
      void navigate(route, navigateOptions);
    },
    [
      isCompactViewport,
      navigate,
      pathname,
      queryClient,
      setRootComposeProjectId,
      store,
    ],
  );
}
