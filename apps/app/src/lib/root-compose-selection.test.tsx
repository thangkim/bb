// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  PaneContext,
  type PaneContextValue,
} from "@/views/thread-detail/PaneContext";
import {
  useRootComposePlacement,
  useRootComposeProjectId,
  useRootComposeReuseEnvironment,
} from "./root-compose-selection";
import type { ComposeSeed, SplitLayout } from "./split-layout";
import { splitLayoutAtom } from "./split-layout/atoms";

afterEach(() => {
  sessionStorage.clear();
});

function paneValue(
  composeId: string | undefined,
  composeSeed?: ComposeSeed,
): PaneContextValue {
  return {
    paneId: composeId ?? "main",
    ...(composeId === undefined ? {} : { composeId }),
    ...(composeSeed === undefined ? {} : { composeSeed }),
    isFocused: true,
    isSplitPane: true,
    secondaryPanelHost: null,
    reservesWindowPanelToggle: false,
    onRequestClose: null,
    isMaximized: false,
    onToggleMaximize: null,
    isBoundedPane: true,
    isTopRow: true,
    ownsWindowTopLeft: false,
    navigateInPane: () => {},
  };
}

const useSelection = () => ({
  project: useRootComposeProjectId(),
  placement: useRootComposePlacement(),
});

describe("root compose targets across layout remounts", () => {
  it("persists placement into a fresh store, then clears it", () => {
    const store = createStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const useTargets = () => ({
      placement: useRootComposePlacement(),
      environment: useRootComposeReuseEnvironment(),
    });
    const first = renderHook(useTargets, { wrapper });
    act(() => {
      first.result.current.placement[1]({
        sectionId: "sec_research",
        pinned: true,
      });
      first.result.current.environment[1]("reuse:env_test");
    });
    first.unmount();
    const reloadedWrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={createStore()}>{children}</Provider>
    );
    const remounted = renderHook(useTargets, { wrapper: reloadedWrapper });
    expect(remounted.result.current.placement[0]).toEqual({
      sectionId: "sec_research",
      pinned: true,
    });
    expect(remounted.result.current.environment[0]).toBe("reuse:env_test");
    act(() => {
      remounted.result.current.placement[1]({ sectionId: null, pinned: false });
      remounted.result.current.environment[1](null);
    });
    remounted.unmount();
    const fresh = renderHook(useTargets, { wrapper: reloadedWrapper });
    expect(fresh.result.current.placement[0]).toEqual({
      sectionId: null,
      pinned: false,
    });
  });
});

describe("root compose selections per composer pane", () => {
  function renderInPane(
    store: ReturnType<typeof createStore>,
    pane: PaneContextValue | null,
  ) {
    return renderHook(useSelection, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>
          <PaneContext.Provider value={pane}>{children}</PaneContext.Provider>
        </Provider>
      ),
    });
  }

  it("keeps two composers side by side on different projects and sections", () => {
    const store = createStore();
    const left = renderInPane(
      store,
      paneValue("compose-a", { projectId: "proj_a" }),
    );
    const right = renderInPane(
      store,
      paneValue("compose-b", { projectId: "proj_b" }),
    );
    const main = renderInPane(store, paneValue(undefined));

    expect(left.result.current.project[0]).toBe("proj_a");
    expect(right.result.current.project[0]).toBe("proj_b");
    expect(main.result.current.project[0]).toBe(PERSONAL_PROJECT_ID);

    act(() => {
      left.result.current.project[1]("proj_c");
      right.result.current.placement[1]({
        sectionId: "sec_right",
        pinned: true,
      });
    });

    expect(left.result.current.project[0]).toBe("proj_c");
    expect(right.result.current.project[0]).toBe("proj_b");
    expect(left.result.current.placement[0]).toEqual({
      sectionId: null,
      pinned: false,
    });
    expect(right.result.current.placement[0]).toEqual({
      sectionId: "sec_right",
      pinned: true,
    });
    expect(main.result.current.placement[0]).toEqual({
      sectionId: null,
      pinned: false,
    });
  });

  it("keeps the default composer's project in its existing tab storage", () => {
    const store = createStore();
    const main = renderInPane(store, paneValue(undefined));

    act(() => main.result.current.project[1]("proj_default"));

    expect(
      Object.values(sessionStorage).some((value) => value === "proj_default"),
    ).toBe(true);
  });

  it("targets the focused composer pane from outside any pane", () => {
    const store = createStore();
    const layout: SplitLayout = {
      root: {
        type: "pane",
        paneId: "pane-1",
        content: {
          kind: "new-thread",
          composeId: "compose-focused",
          seed: { projectId: "proj_focused" },
        },
      },
      focusedPaneId: "pane-1",
    };
    store.set(splitLayoutAtom, layout);
    const pane = renderInPane(
      store,
      paneValue("compose-focused", { projectId: "proj_focused" }),
    );
    const outside = renderInPane(store, null);

    act(() => outside.result.current.project[1]("proj_from_sidebar"));

    expect(pane.result.current.project[0]).toBe("proj_from_sidebar");
  });
});
