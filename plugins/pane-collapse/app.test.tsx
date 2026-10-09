// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  PluginAppBuilder,
  PluginCommandContext,
  PluginCommandRegistration,
  PluginSidebarSplitLayout,
  PluginSidebarThread,
  PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";

const app = await loadPluginApp(() => import("./app"));
const {
  default: definition,
  CollapsePaneButton,
  collapsedPanes,
} = await import("./app");

const commands = new Map<string, PluginCommandRegistration>();
definition.setup({
  commands: {
    register: (registration: PluginCommandRegistration) => {
      commands.set(registration.id, registration);
    },
  },
  slots: {
    experimental_appOverlay: () => {},
    experimental_threadHeaderAction: () => {},
  },
} as unknown as PluginAppBuilder);

const context: PluginCommandContext = {
  threadId: null,
  projectId: null,
  openPanel: () => false,
};

function command(id: string): PluginCommandRegistration {
  const registration = commands.get(id);
  if (registration === undefined) throw new Error(`missing command ${id}`);
  return registration;
}

const PANE_IDS = ["pa", "pb", "pc"] as const;
type PaneId = (typeof PANE_IDS)[number];

function splitLayout(focused: PaneId): PluginSidebarSplitLayout {
  return {
    panes: PANE_IDS.map((paneId, index) => ({
      paneId,
      threadId: `t-${paneId.slice(1)}`,
      rect: { x: index / 3, y: 0, width: 1 / 3, height: 1 },
      isFocused: focused === paneId,
    })),
  };
}

function mountSplitDom(): Record<
  PaneId,
  { pane: HTMLElement; cell: HTMLElement }
> {
  const root = document.createElement("div");
  root.dataset.splitResizeGridRoot = "";
  root.style.display = "flex";
  root.style.flexDirection = "row";
  const grows: Record<PaneId, string> = { pa: "0.25", pb: "0.25", pc: "0.5" };
  const panes = {} as Record<PaneId, { pane: HTMLElement; cell: HTMLElement }>;
  for (const paneId of PANE_IDS) {
    if (root.children.length > 0) {
      const divider = document.createElement("div");
      divider.dataset.splitResizeGridBoundary = String(root.children.length);
      root.append(divider);
    }
    const cell = document.createElement("div");
    cell.style.flex = `${grows[paneId]} 1 0px`;
    const pane = document.createElement("div");
    pane.dataset.splitPaneId = paneId;
    cell.append(pane);
    root.append(cell);
    panes[paneId] = { pane, cell };
  }
  document.body.append(root);
  return panes;
}

function styleText(): string {
  return [...document.head.querySelectorAll("style")]
    .map((style) => style.textContent)
    .join("\n");
}

const threadA = {
  id: "t-a",
  displayTitle: "Alpha thread",
  hasPendingInteraction: true,
} as PluginSidebarThread;

function mountOverlay(focused: PaneId) {
  return renderSlot(
    app.appOverlays[0]!,
    {},
    {
      sidebarSplitLayout: splitLayout(focused),
      sidebarThreads: { threads: [threadA] },
      pluginId: "pane-collapse",
    },
  );
}

afterEach(() => {
  cleanup();
  collapsedPanes.set(new Set());
  document.body.replaceChildren();
});

describe("collapsed pane strips", () => {
  it("shows a chat strip inside the collapsed pane and expands it on click", async () => {
    const panes = mountSplitDom();
    mountOverlay("pb");
    act(() => collapsedPanes.set(new Set(["pa"])));

    const strip = await screen.findByRole("button", {
      name: "Expand Alpha thread",
    });
    expect(panes.pa.pane.contains(strip)).toBe(true);
    expect(styleText()).toContain(
      '[data-pane-collapse-root="0"] > :nth-child(1) { flex: 0 0 36px !important; }',
    );

    fireEvent.click(strip);
    expect(collapsedPanes.get().size).toBe(0);
    expect(screen.queryByRole("button", { name: /Expand/ })).toBeNull();
    expect(styleText()).not.toContain("data-pane-collapse-root");
    expect(document.querySelector("[data-pane-collapse-root]")).toBeNull();
  });

  it("lets the expanded panes fill the width a collapsed pane gives up", async () => {
    const panes = mountSplitDom();
    mountOverlay("pb");
    act(() => collapsedPanes.set(new Set(["pa"])));

    expect(styleText()).toMatch(
      /:nth-child\(3\) \{ flex-grow: 0\.333\d* !important; \}/,
    );
    expect(styleText()).toMatch(
      /:nth-child\(5\) \{ flex-grow: 0\.666\d* !important; \}/,
    );

    panes.pc.cell.style.flex = "0.25 1 0px";
    await waitFor(() =>
      expect(styleText()).toContain(
        ":nth-child(5) { flex-grow: 0.5 !important; }",
      ),
    );
  });

  it("collapses the focused pane by command and focuses its neighbour", () => {
    mountSplitDom();
    const view = mountOverlay("pa");

    expect(command("collapse-focused").isAvailable?.(context)).toBe(true);
    act(() => void command("collapse-focused").run(context));

    expect([...collapsedPanes.get()]).toEqual(["pa"]);
    expect(view.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "t-b",
    });
    expect(command("collapse-focused").isAvailable?.(context)).toBe(false);

    act(() => void command("expand-all").run(context));
    expect(collapsedPanes.get().size).toBe(0);
  });
});

describe("collapse button", () => {
  const props: PluginThreadHeaderActionProps = {
    threadId: "t-a",
    projectId: "p",
    isCompactViewport: false,
  };

  function InPane(paneProps: PluginThreadHeaderActionProps) {
    return (
      <div data-split-pane-id="pa">
        <CollapsePaneButton {...paneProps} />
      </div>
    );
  }

  it("collapses its own pane and hands focus to the other pane", () => {
    const view = renderSlot({ component: InPane }, props, {
      sidebarSplitLayout: splitLayout("pa"),
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse pane" }));

    expect([...collapsedPanes.get()]).toEqual(["pa"]);
    expect(view.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "t-b",
    });
    expect(screen.queryByRole("button", { name: "Collapse pane" })).toBeNull();
  });

  it("is hidden when the thread is not in a split", () => {
    renderSlot({ component: InPane }, props);
    expect(screen.queryByRole("button", { name: "Collapse pane" })).toBeNull();
  });
});
