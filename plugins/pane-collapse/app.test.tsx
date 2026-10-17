// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
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
  PluginThreadActionTarget,
  PluginThreadActionItemInput,
  BbNavigate,
} from "@get-bb/plugin-sdk/app";

const app = await loadPluginApp(() => import("./app"));
const {
  default: definition,
  collapsedPanes,
  minimizePaneAction,
} = await import("./app");
type MinimizeActionData = import("./app").MinimizeActionData;

const commands = new Map<string, PluginCommandRegistration>();
definition.setup({
  commands: {
    register: (registration: PluginCommandRegistration) => {
      commands.set(registration.id, registration);
    },
  },
  slots: {
    experimental_appOverlay: () => {},
    experimental_threadAction: () => {},
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

function mountTitleBar(): HTMLElement {
  const titleBar = document.createElement("div");
  titleBar.dataset.testid = "app-window-title-bar";
  const left = document.createElement("div");
  left.id = "left-controls";
  const right = document.createElement("div");
  right.id = "right-toggle";
  titleBar.append(left, right);
  document.body.append(titleBar);
  return titleBar;
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

const sentMessages: unknown[] = [];

function mountOverlay(focused: PaneId) {
  return renderSlot(
    app.appOverlays[0]!,
    {},
    {
      sidebarSplitLayout: splitLayout(focused),
      sidebarThreads: { threads: [threadA] },
      pluginId: "pane-collapse",
      sdk: {
        threads: {
          output: async () => ({ output: "Plan drafted. Want me to start?" }),
          send: async (args) => {
            sentMessages.push(args);
            return { ok: true, delivery: "sent" };
          },
        },
      },
    },
  );
}

afterEach(() => {
  cleanup();
  sentMessages.length = 0;
  collapsedPanes.set(new Set());
  document.body.replaceChildren();
});

describe("collapsed pane strips", () => {
  it("shows a chat strip inside the collapsed pane and expands it on click", async () => {
    const panes = mountSplitDom();
    mountOverlay("pb");
    act(() => collapsedPanes.set(new Set(["pa"])));

    const strip = await screen.findByRole("button", {
      name: "Restore Alpha thread",
    });
    expect(panes.pa.pane.contains(strip)).toBe(true);
    expect(styleText()).toContain(
      `${'[data-pane-collapse-root="0"]'.repeat(3)} > :nth-child(1) { flex: 0 0 36px !important; }`,
    );

    fireEvent.click(strip);
    expect(collapsedPanes.get().size).toBe(0);
    expect(screen.queryByRole("button", { name: /Restore/ })).toBeNull();
    expect(styleText()).not.toContain("data-pane-collapse-root");
    expect(document.querySelector("[data-pane-collapse-root]")).toBeNull();
  });

  it("shows the thread's linked task or project on the strip and follows changes", async () => {
    const panes = mountSplitDom();
    const badge = document.createElement("button");
    panes.pa.pane.append(badge);
    mountOverlay("pb");
    act(() => collapsedPanes.set(new Set(["pa"])));
    await screen.findByRole("button", { name: "Restore Alpha thread" });

    badge.dataset.linkedWorkKind = "task";
    badge.dataset.linkedWorkLabel = "Write the launch post";
    const strip = await screen.findByRole("button", {
      name: "Restore Alpha thread — Task Write the launch post",
    });
    expect(strip.textContent).toBe("Alpha threadWrite the launch post");

    badge.dataset.linkedWorkKind = "project";
    badge.dataset.linkedWorkLabel = "Launch";
    badge.dataset.linkedWorkColor = "#ff0000";
    await screen.findByRole("button", {
      name: "Restore Alpha thread — Project Launch",
    });
    expect(
      strip.querySelector<HTMLElement>(".rounded-full:not(.bg-attention)")
        ?.style.backgroundColor,
    ).toBe("rgb(255, 0, 0)");

    badge.remove();
    await screen.findByRole("button", { name: "Restore Alpha thread" });
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

  it("scales only the cells another plugin has not pinned", () => {
    const panes = mountSplitDom();
    const computed = window.getComputedStyle.bind(window);
    const spy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((element, pseudo) =>
        element === panes.pc.cell
          ? ({ flexGrow: "0.4" } as CSSStyleDeclaration)
          : computed(element, pseudo),
      );
    mountOverlay("pb");
    act(() => collapsedPanes.set(new Set(["pa"])));

    expect(styleText()).toContain(":nth-child(3) { flex-grow: 1 !important; }");
    expect(styleText()).not.toContain(":nth-child(5)");
    spy.mockRestore();
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

describe("minimized threads in the window title bar", () => {
  it("hides the pane, shows a chip between the title bar controls, and restores on click", async () => {
    const titleBar = mountTitleBar();
    mountSplitDom();
    const view = mountOverlay("pb");
    act(() => collapsedPanes.set(new Set(["pa"])));

    const chip = await screen.findByRole("button", {
      name: "Restore Alpha thread",
    });
    const tray = titleBar.querySelector("[data-pane-collapse-tray]");
    expect(tray?.contains(chip)).toBe(true);
    expect([...titleBar.children].map((child) => child.id || "tray")).toEqual([
      "left-controls",
      "tray",
      "right-toggle",
    ]);
    expect(chip.querySelector(".bg-attention")).not.toBeNull();

    const root = '[data-pane-collapse-root="0"]'.repeat(3);
    expect(styleText()).toContain(
      `${root} > :nth-child(1):not(:has([data-maximized])) { display: none !important; }`,
    );
    expect(styleText()).toContain(
      `${root} > :nth-child(2) { display: none !important; }`,
    );
    expect(styleText()).not.toContain(":nth-child(4) { display: none");
    expect(styleText()).not.toContain("36px");
    expect(document.querySelector("[data-pane-collapse-strip]")).toBeNull();

    fireEvent.click(chip);
    expect(collapsedPanes.get().size).toBe(0);
    expect(view.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "t-a",
    });
    expect(titleBar.querySelector("[data-pane-collapse-tray]")).toBeNull();
    expect(styleText()).not.toContain("data-pane-collapse-root");
  });

  it("lists the most recently minimized pane first", async () => {
    mountTitleBar();
    mountSplitDom();
    mountOverlay("pb");
    act(() => collapsedPanes.set(new Set(["pc", "pa"])));

    const tray = await waitFor(() => {
      const element = document.querySelector("[data-pane-collapse-tray]");
      expect(element?.children).toHaveLength(2);
      return element!;
    });
    expect(
      [...tray.querySelectorAll("button")].map((chip) =>
        chip.getAttribute("aria-label"),
      ),
    ).toEqual(["Restore Alpha thread", "Restore Thread"]);
  });
});

describe("minimized thread chip", () => {
  it("shows the linked task beside the title", async () => {
    mountTitleBar();
    const panes = mountSplitDom();
    const badge = document.createElement("button");
    badge.dataset.linkedWorkKind = "task";
    badge.dataset.linkedWorkLabel = "Install anfra";
    panes.pa.pane.append(badge);
    mountOverlay("pb");
    act(() => collapsedPanes.set(new Set(["pa"])));

    const chip = await screen.findByRole("button", {
      name: "Restore Alpha thread — Task Install anfra",
    });
    expect(chip.textContent).toBe("Alpha threadInstall anfra");
  });

  it("turns the chat icon blue while a finished reply is unread", async () => {
    mountTitleBar();
    mountSplitDom();
    const threads = [
      { ...threadA, hasPendingInteraction: false, indicator: "unread-success" },
      { id: "t-c", displayTitle: "Gamma", indicator: "none" },
    ] as PluginSidebarThread[];
    renderSlot(
      app.appOverlays[0]!,
      {},
      {
        sidebarSplitLayout: splitLayout("pb"),
        sidebarThreads: { threads },
        pluginId: "pane-collapse",
      },
    );
    act(() => collapsedPanes.set(new Set(["pa", "pc"])));

    const finished = await screen.findByRole("button", {
      name: "Restore Alpha thread, new reply",
    });
    const read = screen.getByRole("button", { name: "Restore Gamma" });
    expect(finished.querySelector("svg")?.getAttribute("class")).toContain(
      "text-timeline-accent",
    );
    expect(read.querySelector("svg")?.getAttribute("class")).not.toContain(
      "text-timeline-accent",
    );
  });

  it("opens on hover with the latest message and sends a quick reply", async () => {
    mountTitleBar();
    mountSplitDom();
    mountOverlay("pb");
    act(() => collapsedPanes.set(new Set(["pa"])));
    const chip = await screen.findByRole("button", {
      name: "Restore Alpha thread",
    });

    fireEvent.pointerEnter(chip);
    expect(
      await screen.findByText("Plan drafted. Want me to start?"),
    ).toBeDefined();
    expect(
      screen.getByText(/Waiting for your approval or answer/),
    ).toBeDefined();

    const reply = screen.getByRole("textbox", { name: "Reply" });
    fireEvent.change(reply, { target: { value: "  Yes, go ahead  " } });
    fireEvent.keyDown(reply, { key: "Enter" });

    await screen.findByText("Sent");
    expect(sentMessages).toEqual([
      {
        threadId: "t-a",
        input: [{ type: "text", text: "Yes, go ahead", mentions: [] }],
        mode: "queue-if-active",
      },
    ]);
    expect((reply as HTMLTextAreaElement).value).toBe("");
    expect(collapsedPanes.get().has("pa")).toBe(true);
  });

  it("keeps Shift+Enter as a new line", async () => {
    mountTitleBar();
    mountSplitDom();
    mountOverlay("pb");
    act(() => collapsedPanes.set(new Set(["pa"])));
    fireEvent.pointerEnter(
      await screen.findByRole("button", { name: "Restore Alpha thread" }),
    );
    const reply = await screen.findByRole("textbox", { name: "Reply" });
    fireEvent.change(reply, { target: { value: "line one" } });
    fireEvent.keyDown(reply, { key: "Enter", shiftKey: true });
    expect(sentMessages).toEqual([]);
  });
});

describe("minimize pane thread action", () => {
  const thread = { id: "t-a" } as PluginThreadActionTarget;

  function item(data: MinimizeActionData) {
    const navigateCalls: string[] = [];
    const navigate = {
      toThread: (threadId: string) => navigateCalls.push(threadId),
    } as unknown as BbNavigate;
    const action = minimizePaneAction({
      thread,
      data,
      navigate,
    } as PluginThreadActionItemInput<MinimizeActionData>);
    return { action, navigateCalls };
  }

  it("minimizes the thread's pane and hands focus to its neighbour", async () => {
    const { action, navigateCalls } = item({
      layout: splitLayout("pa"),
      collapsed: new Set(),
    });
    expect(action?.label).toBe("Minimize pane");

    await action?.run({ requestRename: () => {} });

    expect([...collapsedPanes.get()]).toEqual(["pa"]);
    expect(navigateCalls).toEqual(["t-b"]);
  });

  it("is hidden outside a split, when already minimized, and on the last expanded pane", () => {
    expect(item({ layout: null, collapsed: new Set() }).action).toBeNull();
    expect(
      item({ layout: splitLayout("pb"), collapsed: new Set(["pa"]) }).action,
    ).toBeNull();
    expect(
      item({ layout: splitLayout("pa"), collapsed: new Set(["pb", "pc"]) })
        .action,
    ).toBeNull();
  });

  it("restores the most recently minimized pane by command and focuses its thread", () => {
    mountSplitDom();
    const view = mountOverlay("pb");
    act(() => collapsedPanes.set(new Set(["pc", "pa"])));

    expect(command("restore-latest").isAvailable?.(context)).toBe(true);
    act(() => void command("restore-latest").run(context));

    expect([...collapsedPanes.get()]).toEqual(["pc"]);
    expect(view.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "t-a",
    });

    act(() => void command("restore-latest").run(context));
    expect(collapsedPanes.get().size).toBe(0);
    expect(command("restore-latest").isAvailable?.(context)).toBe(false);
  });

  it("binds Shift+Option+Z to minimize and Cmd+Ctrl+Z to restore by default", () => {
    expect(command("restore-latest").defaultShortcut).toEqual({
      key: "z",
      meta: true,
      control: true,
    });
    expect(command("collapse-focused").defaultShortcut).toEqual({
      key: "z",
      alt: true,
      shift: true,
    });
  });
});
