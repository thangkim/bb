// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
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

function splitLayout(focused: string): PluginSidebarSplitLayout {
  return {
    panes: [
      {
        paneId: "pa",
        threadId: "t-a",
        rect: { x: 0, y: 0, width: 0.5, height: 1 },
        isFocused: focused === "pa",
      },
      {
        paneId: "pb",
        threadId: "t-b",
        rect: { x: 0.5, y: 0, width: 0.5, height: 1 },
        isFocused: focused === "pb",
      },
    ],
  };
}

function mountSplitDom(): Record<"pa" | "pb", HTMLElement> {
  const root = document.createElement("div");
  root.dataset.splitResizeGridRoot = "";
  root.style.display = "flex";
  root.style.flexDirection = "row";
  const panes = {} as Record<"pa" | "pb", HTMLElement>;
  for (const paneId of ["pa", "pb"] as const) {
    const cell = document.createElement("div");
    const pane = document.createElement("div");
    pane.dataset.splitPaneId = paneId;
    cell.append(pane);
    root.append(cell);
    panes[paneId] = pane;
  }
  document.body.append(root);
  return panes;
}

const threadA = {
  id: "t-a",
  displayTitle: "Alpha thread",
  hasPendingInteraction: true,
} as PluginSidebarThread;

function mountOverlay(focused: string) {
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
    expect(panes.pa.contains(strip)).toBe(true);
    expect(document.head.textContent).toContain(
      'div:has(> [data-split-pane-id="pa"]) { flex: 0 0 36px !important; }',
    );

    fireEvent.click(strip);
    expect(collapsedPanes.get().size).toBe(0);
    expect(screen.queryByRole("button", { name: /Expand/ })).toBeNull();
    expect(document.head.textContent).not.toContain("data-split-pane-id");
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
