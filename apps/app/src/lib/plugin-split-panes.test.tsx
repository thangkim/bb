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
import {
  rootComposeProjectIdAtomFor,
  useRootComposeProjectId,
} from "./root-compose-selection";
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

function focusedContent(store: ReturnType<typeof createStore>) {
  const layout = layoutOf(store);
  return findPane(layout.root, layout.focusedPaneId)?.content;
}

function composers(store: ReturnType<typeof createStore>) {
  return listPanes(layoutOf(store).root).filter(
    (pane) => pane.content.kind === "new-thread",
  );
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

interface Point {
  x: number;
  y: number;
}

describe("useSplitPanes", () => {
  it.each([
    ["left", (rect: Point, base: Point) => rect.x < base.x],
    ["right", (rect: Point, base: Point) => rect.x > base.x],
    ["top", (rect: Point, base: Point) => rect.y < base.y],
    ["bottom", (rect: Point, base: Point) => rect.y > base.y],
  ] as const)(
    "splits a composer off to the %s, seeded from the focused thread",
    (side, isOnSide) => {
      const { store, result, open } = renderSplitPanes({
        layout: singlePane(),
      });

      expect(result.current.panes.isAvailable).toBe(true);
      expect(open({ side })).toBe("opened");

      const layout = layoutOf(store);
      expect(focusedContent(store)).toMatchObject({
        kind: "new-thread",
        seed: { projectId: "proj_open", environmentId: "env_shared" },
      });
      const rects = computePaneRects(layout.root);
      const composerRect = rects.get(layout.focusedPaneId);
      const threadRect = rects.get("pane-1");
      if (composerRect === undefined || threadRect === undefined) {
        throw new Error("expected both panes to have rects");
      }
      expect(isOnSide(composerRect, threadRect)).toBe(true);
      expect(result.current.location.pathname).toBe("/");
      expect(result.current.location.state).toEqual({ focusPrompt: true });
      expect(result.current.composeProjectId).toBe("proj_open");
    },
  );

  it("opens a second, independent composer on every split", () => {
    const { store, result, open } = renderSplitPanes({ layout: singlePane() });

    expect(open({ side: "right" })).toBe("opened");
    expect(open({ side: "bottom", projectId: "proj_other" })).toBe("opened");

    const opened = composers(store);
    expect(opened).toHaveLength(2);
    const [first, second] = opened.map((pane) => pane.content);
    if (first?.kind !== "new-thread" || second?.kind !== "new-thread") {
      throw new Error("expected two composers");
    }
    expect(first.composeId).toBeDefined();
    expect(second.composeId).toBeDefined();
    expect(first.composeId).not.toBe(second.composeId);
    expect(first.seed).toEqual({
      projectId: "proj_open",
      environmentId: "env_shared",
    });
    expect(second.seed).toEqual({ projectId: "proj_other" });
    expect(result.current.composeProjectId).toBe("proj_other");
    expect(
      store.get(rootComposeProjectIdAtomFor(first.composeId, "unused")),
    ).toBe("proj_open");
  });

  it("seeds a split from a focused composer with that composer's project", () => {
    const { store, open } = renderSplitPanes({ layout: singlePane() });
    open({ side: "right" });
    const seeded = focusedContent(store);
    if (seeded?.kind !== "new-thread") throw new Error("expected a composer");
    act(() =>
      store.set(rootComposeProjectIdAtomFor(seeded.composeId), "proj_picked"),
    );

    open({ side: "bottom" });

    expect(focusedContent(store)).toMatchObject({
      kind: "new-thread",
      seed: { projectId: "proj_picked" },
    });
    expect(composers(store)).toHaveLength(2);
  });

  it("builds the first layout from the route when nothing was stored yet", () => {
    const { store, open } = renderSplitPanes({ layout: null });

    expect(open({ side: "right" })).toBe("opened");

    expect(
      listPanes(layoutOf(store).root).map((pane) => pane.content.kind),
    ).toEqual(["thread", "new-thread"]);
  });

  describe("reuseComposer", () => {
    it("keeps a focused composer instead of opening another", () => {
      const { store, open } = renderSplitPanes({ layout: singlePane() });
      open({ side: "right" });
      const before = layoutOf(store);

      expect(open({ side: "right", reuseComposer: true })).toBe("focused");

      expect(layoutOf(store)).toEqual(before);
    });

    it("focuses an open composer seeded with the same project and environment", () => {
      const { store, open } = renderSplitPanes({ layout: singlePane() });
      open({ side: "right" });
      const composerPaneId = layoutOf(store).focusedPaneId;
      act(() =>
        store.set(splitLayoutAtom, {
          ...layoutOf(store),
          focusedPaneId: "pane-1",
        }),
      );

      expect(open({ side: "right", reuseComposer: true })).toBe("focused");

      expect(layoutOf(store).focusedPaneId).toBe(composerPaneId);
      expect(composers(store)).toHaveLength(1);
    });

    it("keeps a focused composer only when it is on the requested project", () => {
      const { store, open } = renderSplitPanes({ layout: singlePane() });
      open({ side: "right" });

      expect(
        open({ side: "right", projectId: "proj_open", reuseComposer: true }),
      ).toBe("focused");
      expect(
        open({ side: "right", projectId: "proj_other", reuseComposer: true }),
      ).toBe("opened");

      expect(focusedContent(store)).toMatchObject({
        kind: "new-thread",
        seed: { projectId: "proj_other" },
      });
      expect(composers(store)).toHaveLength(2);
    });

    it("opens a composer when none matches the focused thread", () => {
      const withDefault = splitPane(singlePane(), "pane-1", "right", {
        kind: "new-thread",
      });
      const { store, open } = renderSplitPanes({
        layout: { ...withDefault, focusedPaneId: "pane-1" },
      });

      expect(open({ side: "right", reuseComposer: true })).toBe("opened");

      expect(composers(store)).toHaveLength(2);
    });
  });

  it("hands the section and environment to the new composer", () => {
    const { store, result, open } = renderSplitPanes({ layout: singlePane() });

    expect(
      open({
        side: "right",
        projectId: "proj_other",
        sectionId: "sec_inbox",
        environmentId: "env_reused",
      }),
    ).toBe("opened");

    expect(focusedContent(store)).toMatchObject({
      kind: "new-thread",
      seed: { projectId: "proj_other", environmentId: "env_reused" },
    });
    expect(result.current.location.state).toEqual({
      focusPrompt: true,
      sectionId: "sec_inbox",
      reuseEnvironmentId: "env_reused",
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
    expect(findPane(layout.root, "pane-1")?.content).toMatchObject({
      kind: "new-thread",
      seed: { projectId: "proj_open" },
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
