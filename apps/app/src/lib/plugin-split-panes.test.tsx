// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider, createStore } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { ExperimentalSplitPaneNewThreadOptions } from "@get-bb/plugin-sdk";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { createAppQueryClient } from "./query-client";
import { useRootComposeProjectId } from "./root-compose-selection";
import {
  computePaneRects,
  findPane,
  listPanes,
  MAX_PANES,
  splitPane,
  type PaneContent,
  type SplitLayout,
} from "./split-layout";
import { maximizedPaneIdAtom, splitLayoutAtom } from "./split-layout/atoms";
import { useSplitPanes } from "./plugin-split-panes";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

const THREAD_PATH = "/projects/proj_open/threads/thr_watching";

function thread(threadId: string): PaneContent {
  return { kind: "thread", projectId: "proj_open", threadId };
}

function singlePane(content: PaneContent = thread("thr_watching")) {
  return {
    root: { type: "pane", paneId: "pane-1", content },
    focusedPaneId: "pane-1",
  } satisfies SplitLayout;
}

function renderSplitPanes({
  layout,
  path = THREAD_PATH,
  compact = false,
}: {
  layout: SplitLayout | null;
  path?: string;
  compact?: boolean;
}) {
  const store = createStore();
  store.set(splitLayoutAtom, layout);
  const queryClient = createAppQueryClient();
  queryClient.setQueryData(
    threadQueryKey("thr_watching"),
    makeThreadResponse({
      id: "thr_watching",
      projectId: "proj_open",
      environmentId: "env_shared",
    }),
  );
  const { result } = renderHook(
    () => ({
      panes: useSplitPanes(),
      location: useLocation(),
      composeProjectId: useRootComposeProjectId()[0],
    }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <CompactViewportOverrideProvider isCompactViewport={compact}>
          <MemoryRouter initialEntries={[path]}>
            <QueryClientProvider client={queryClient}>
              <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
          </MemoryRouter>
        </CompactViewportOverrideProvider>
      ),
    },
  );
  const open = (options: ExperimentalSplitPaneNewThreadOptions) => {
    let outcome: string | undefined;
    act(() => {
      outcome = result.current.panes.openNewThread(options);
    });
    return outcome;
  };
  return { store, result, open };
}

function layoutOf(store: ReturnType<typeof createStore>): SplitLayout {
  const layout = store.get(splitLayoutAtom);
  if (layout === null) throw new Error("expected a split layout");
  return layout;
}

function fullLayout(): SplitLayout {
  let layout: SplitLayout = singlePane();
  for (let index = 2; index <= MAX_PANES; index += 1) {
    layout = splitPane(
      layout,
      layout.focusedPaneId,
      "right",
      thread(`thr_${index}`),
    );
  }
  return { ...layout, focusedPaneId: "pane-1" };
}

describe("useSplitPanes", () => {
  it.each([
    ["left", (rect: DOMRectLike, base: DOMRectLike) => rect.x < base.x],
    ["right", (rect: DOMRectLike, base: DOMRectLike) => rect.x > base.x],
    ["top", (rect: DOMRectLike, base: DOMRectLike) => rect.y < base.y],
    ["bottom", (rect: DOMRectLike, base: DOMRectLike) => rect.y > base.y],
  ] as const)(
    "splits a focused composer off to the %s, seeded from the focused thread",
    (side, isOnSide) => {
      const { store, result, open } = renderSplitPanes({
        layout: singlePane(),
      });

      expect(result.current.panes.isAvailable).toBe(true);
      expect(open({ side })).toBe("opened");

      const layout = layoutOf(store);
      const focused = findPane(layout.root, layout.focusedPaneId);
      expect(focused?.content).toEqual({ kind: "new-thread" });
      const rects = computePaneRects(layout.root);
      const composerRect = rects.get(layout.focusedPaneId);
      const threadRect = rects.get("pane-1");
      if (composerRect === undefined || threadRect === undefined) {
        throw new Error("expected both panes to have rects");
      }
      expect(isOnSide(composerRect, threadRect)).toBe(true);
      expect(result.current.location.pathname).toBe("/");
      expect(result.current.location.state).toEqual({
        focusPrompt: true,
        reuseEnvironmentId: "env_shared",
      });
      expect(result.current.composeProjectId).toBe("proj_open");
    },
  );

  it("uses an explicit project without carrying the focused thread's environment", () => {
    const { result, open } = renderSplitPanes({ layout: singlePane() });

    expect(
      open({ side: "right", projectId: "proj_other", focusPrompt: false }),
    ).toBe("opened");

    expect(result.current.composeProjectId).toBe("proj_other");
    expect(result.current.location.state).toEqual({});
  });

  it("builds the first layout from the route when nothing was stored yet", () => {
    const { store, open } = renderSplitPanes({ layout: null });

    expect(open({ side: "right" })).toBe("opened");

    expect(listPanes(layoutOf(store).root).map((pane) => pane.content)).toEqual(
      [thread("thr_watching"), { kind: "new-thread" }],
    );
  });

  it("focuses the existing composer instead of opening a second one", () => {
    const withComposer = splitPane(singlePane(), "pane-1", "right", {
      kind: "new-thread",
    });
    const { store, open } = renderSplitPanes({
      layout: { ...withComposer, focusedPaneId: "pane-1" },
    });

    expect(open({ side: "left" })).toBe("focused");

    const layout = layoutOf(store);
    expect(listPanes(layout.root)).toHaveLength(2);
    expect(findPane(layout.root, layout.focusedPaneId)?.content).toEqual({
      kind: "new-thread",
    });
  });

  it("refuses at the pane cap by default and leaves the layout alone", () => {
    const full = fullLayout();
    const { store, result, open } = renderSplitPanes({ layout: full });

    expect(open({ side: "right" })).toBe("at-cap");

    expect(layoutOf(store)).toEqual(full);
    expect(result.current.location.pathname).toBe(THREAD_PATH);
  });

  it("replaces the focused pane at the cap when asked to", () => {
    const { store, open } = renderSplitPanes({ layout: fullLayout() });

    expect(open({ side: "right", atPaneCap: "replace" })).toBe("replaced");

    const layout = layoutOf(store);
    expect(listPanes(layout.root)).toHaveLength(MAX_PANES);
    expect(layout.focusedPaneId).toBe("pane-1");
    expect(findPane(layout.root, "pane-1")?.content).toEqual({
      kind: "new-thread",
    });
  });

  it("moves a maximized view onto the new composer", () => {
    const { store, open } = renderSplitPanes({ layout: singlePane() });
    act(() => store.set(maximizedPaneIdAtom, "pane-1"));

    open({ side: "right" });

    expect(store.get(maximizedPaneIdAtom)).toBe(layoutOf(store).focusedPaneId);
  });

  it("is unavailable on compact viewports", () => {
    const { store, result, open } = renderSplitPanes({
      layout: singlePane(),
      compact: true,
    });

    expect(result.current.panes.isAvailable).toBe(false);
    expect(open({ side: "right" })).toBe("unavailable");
    expect(layoutOf(store)).toEqual(singlePane());
    expect(result.current.location.pathname).toBe(THREAD_PATH);
  });

  it("is unavailable on routes that cannot be shown in a pane", () => {
    const { result, open } = renderSplitPanes({
      layout: singlePane(),
      path: "/settings",
    });

    expect(result.current.panes.isAvailable).toBe(false);
    expect(open({ side: "right" })).toBe("unavailable");
  });
});

interface DOMRectLike {
  x: number;
  y: number;
}
