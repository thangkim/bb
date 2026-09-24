// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider, createStore } from "jotai";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { createAppQueryClient } from "@/lib/query-client";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { defaultRootComposeProjectIdAtom } from "@/lib/root-compose-selection";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  countPanes,
  DEFAULT_COMPOSE_ID,
  findPane,
  listPanes,
  MAX_PANES,
  splitPane,
  type PaneContent,
  type SplitLayout,
} from "@/lib/split-layout";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { useOpenNewThreadPane } from "./useOpenNewThreadPane";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  isCompactViewport: false,
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => mocks.isCompactViewport,
}));

const WATCHING_PATH = "/projects/proj_open/threads/thr_watching";

function threadContent(threadId: string): PaneContent {
  return { kind: "thread", projectId: "proj_open", threadId };
}

function threadLayout(threadId: string): SplitLayout {
  return {
    root: { type: "pane", paneId: "pane_1", content: threadContent(threadId) },
    focusedPaneId: "pane_1",
  };
}

function cacheThread(
  queryClient: QueryClient,
  threadId: string,
  environmentId: string,
) {
  queryClient.setQueryData(
    threadQueryKey(threadId),
    makeThreadResponse({ id: threadId, projectId: "proj_open", environmentId }),
  );
}

function renderOpener({
  layout,
  path = WATCHING_PATH,
}: {
  layout: SplitLayout | null;
  path?: string;
}) {
  const store = createStore();
  store.set(splitLayoutAtom, layout);
  const queryClient = createAppQueryClient();
  cacheThread(queryClient, "thr_watching", "env_shared");
  const { result } = renderHook(() => useOpenNewThreadPane(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[path]}>
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>{children}</Provider>
        </QueryClientProvider>
      </MemoryRouter>
    ),
  });
  const open = (options?: Parameters<typeof result.current>[0]) =>
    act(() => {
      result.current(options);
    });
  return { store, open };
}

function focusedContent(store: ReturnType<typeof createStore>) {
  const layout = store.get(splitLayoutAtom)!;
  return findPane(layout.root, layout.focusedPaneId)?.content;
}

afterEach(() => {
  cleanup();
  mocks.isCompactViewport = false;
  vi.clearAllMocks();
});

describe("useOpenNewThreadPane", () => {
  it("opens a composer to the right of the focused thread, bound to its project and environment", () => {
    const { store, open } = renderOpener({
      layout: threadLayout("thr_watching"),
    });

    open();

    const layout = store.get(splitLayoutAtom)!;
    const root = layout.root;
    if (root.type !== "split") throw new Error("Expected a split");
    expect(root.dir).toBe("row");
    const [left, right] = root.children;
    expect(left).toMatchObject({ content: threadContent("thr_watching") });
    if (right?.type !== "pane") throw new Error("Expected a pane");
    expect(layout.focusedPaneId).toBe(right.paneId);
    expect(right.content).toMatchObject({
      kind: "new-thread",
      seed: { projectId: "proj_open", environmentId: "env_shared" },
    });
    expect(mocks.navigate).toHaveBeenCalledWith(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
  });

  it("splits a lone thread even before any layout was stored", () => {
    const { store, open } = renderOpener({ layout: null });

    open();

    const layout = store.get(splitLayoutAtom)!;
    expect(countPanes(layout.root)).toBe(2);
    expect(focusedContent(store)).toMatchObject({
      kind: "new-thread",
      seed: { projectId: "proj_open", environmentId: "env_shared" },
    });
  });

  it("focuses the composer already open for that project instead of stacking another", () => {
    const { store, open } = renderOpener({
      layout: threadLayout("thr_watching"),
    });
    open();
    const composerPaneId = store.get(splitLayoutAtom)!.focusedPaneId;
    store.set(splitLayoutAtom, {
      ...store.get(splitLayoutAtom)!,
      focusedPaneId: "pane_1",
    });

    open();

    const layout = store.get(splitLayoutAtom)!;
    expect(countPanes(layout.root)).toBe(2);
    expect(layout.focusedPaneId).toBe(composerPaneId);
  });

  it("keeps the layout when the focused pane is already a composer", () => {
    const composerLayout: SplitLayout = {
      root: {
        type: "pane",
        paneId: "pane_1",
        content: { kind: "new-thread", composeId: DEFAULT_COMPOSE_ID },
      },
      focusedPaneId: "pane_1",
    };
    const { store, open } = renderOpener({
      layout: composerLayout,
      path: getRootComposeRoutePath(),
    });

    open();

    expect(store.get(splitLayoutAtom)).toBe(composerLayout);
    expect(mocks.navigate).toHaveBeenCalledWith(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
  });

  it("replaces the focused pane once the pane cap is reached", () => {
    let layout = threadLayout("thr_0");
    for (let index = 1; index < MAX_PANES; index += 1) {
      layout = splitPane(
        layout,
        layout.focusedPaneId,
        "right",
        threadContent(
          index === MAX_PANES - 1 ? "thr_watching" : `thr_${index}`,
        ),
      );
    }
    const { store, open } = renderOpener({ layout });

    open();

    const next = store.get(splitLayoutAtom)!;
    expect(countPanes(next.root)).toBe(MAX_PANES);
    expect(next.focusedPaneId).toBe(layout.focusedPaneId);
    expect(focusedContent(store)).toMatchObject({
      kind: "new-thread",
      seed: { projectId: "proj_open" },
    });
    expect(
      listPanes(next.root).some(
        (pane) =>
          pane.content.kind === "thread" &&
          pane.content.threadId === "thr_watching",
      ),
    ).toBe(false);
  });

  it("falls back to the active project when the route is not a pane", () => {
    const { store, open } = renderOpener({
      layout: threadLayout("thr_watching"),
      path: "/settings",
    });
    store.set(defaultRootComposeProjectIdAtom, "proj_active");

    open();

    expect(focusedContent(store)).toEqual({
      kind: "new-thread",
      composeId: expect.any(String),
      seed: { projectId: "proj_active" },
    });
  });

  it("navigates without splitting on a compact viewport", () => {
    mocks.isCompactViewport = true;
    const { store, open } = renderOpener({
      layout: threadLayout("thr_watching"),
    });

    open({ projectId: "proj_open" });

    expect(countPanes(store.get(splitLayoutAtom)!.root)).toBe(1);
    expect(store.get(defaultRootComposeProjectIdAtom)).toBe("proj_open");
    expect(mocks.navigate).toHaveBeenCalledWith(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
  });
});
