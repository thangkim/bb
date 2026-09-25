// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ForkThreadCreateSeed } from "@bb/client-core";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  PaneContext,
  type PaneContextValue,
} from "@/views/thread-detail/PaneContext";
import {
  useRootComposeForkSeed,
  useRootComposeProjectId,
  useRootComposeSectionId,
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
  section: useRootComposeSectionId(),
});

describe("root compose targets across layout remounts", () => {
  it("retains section and fork targets when the composer remounts, then clears them", () => {
    const store = createStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const useTargets = () => ({
      section: useRootComposeSectionId(),
      fork: useRootComposeForkSeed(),
    });
    const fork: ForkThreadCreateSeed = {
      environmentId: "env_test",
      model: "test-model",
      permissionMode: "accept-edits",
      projectId: "proj_test",
      providerId: "test-provider",
      reasoningLevel: "medium",
      serviceTier: undefined,
      sourceSeqEnd: undefined,
      sourceThreadId: "thr_source",
      sourceThreadTitle: "Source thread",
    };
    const first = renderHook(useTargets, { wrapper });
    act(() => {
      first.result.current.section[1]("sec_research");
      first.result.current.fork[1](fork);
    });
    first.unmount();
    const remounted = renderHook(useTargets, { wrapper });
    expect(remounted.result.current.section[0]).toBe("sec_research");
    expect(remounted.result.current.fork[0]).toEqual(fork);
    act(() => {
      remounted.result.current.section[1](null);
      remounted.result.current.fork[1](null);
    });
    remounted.unmount();
    const fresh = renderHook(useTargets, { wrapper });
    expect(fresh.result.current.section[0]).toBeNull();
    expect(fresh.result.current.fork[0]).toBeNull();
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
      right.result.current.section[1]("sec_right");
    });

    expect(left.result.current.project[0]).toBe("proj_c");
    expect(right.result.current.project[0]).toBe("proj_b");
    expect(left.result.current.section[0]).toBeNull();
    expect(right.result.current.section[0]).toBe("sec_right");
    expect(main.result.current.section[0]).toBeNull();
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
