// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  contentScripts: { register: () => {} },
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

function mountOverlay(
  focused: PaneId,
  settings?: Record<string, string | number | boolean>,
) {
  return renderSlot(
    app.appOverlays[0]!,
    {},
    {
      settings,
      sidebarSplitLayout: splitLayout(focused),
      sidebarThreads: { threads: [threadA] },
      pluginId: "pane-collapse",
      sdk: {
        threads: {
          output: async () => ({ output: "Plan drafted. Want me to start?" }),
          conversationOutline: async () => ({
            items: [
              {
                id: "m1",
                role: "user",
                preview: "Older ask",
                attachmentSummary: null,
              },
              {
                id: "m2",
                role: "user",
                preview: "Draft a plan",
                attachmentSummary: null,
              },
            ],
            maxSeq: 2,
          }),
          context: async () => ({
            usage: {
              usedTokens: 50_000,
              modelContextWindow: 200_000,
              estimated: false,
            },
          }),
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

describe("minimized threads on the left rail", () => {
  const railSettings = { display: "Vertical strips on the left" };
  const threadB = {
    id: "t-b",
    displayTitle: "Beta thread",
    hasPendingInteraction: false,
  } as PluginSidebarThread;

  it("gathers collapsed panes in a rail at the start of the split row, most recent leftmost", async () => {
    const panes = mountSplitDom();
    const root = panes.pa.cell.parentElement!;
    renderSlot(
      app.appOverlays[0]!,
      {},
      {
        settings: railSettings,
        sidebarSplitLayout: splitLayout("pc"),
        sidebarThreads: { threads: [threadA, threadB] },
        pluginId: "pane-collapse",
      },
    );
    act(() => collapsedPanes.set(new Set(["pa", "pb"])));

    const rail = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        "[data-pane-collapse-rail]",
      );
      expect(found).not.toBeNull();
      return found!;
    });
    expect(root.firstElementChild).toBe(rail);
    expect(rail.nextElementSibling).toBe(panes.pa.cell);
    expect(
      [...rail.querySelectorAll("button")].map((button) => button.title),
    ).toEqual(["Beta thread", "Alpha thread"]);
    expect(rail.contains(panes.pa.pane)).toBe(false);
    expect(document.querySelector("[data-pane-collapse-tray]")).toBeNull();
    const hidden = (nthChild: number) =>
      `${'[data-pane-collapse-root="0"]'.repeat(3)} > :nth-child(${nthChild}):not(:has([data-maximized])) { display: none !important; }`;
    expect(styleText()).toContain(hidden(2));
    expect(styleText()).toContain(hidden(4));
    expect(styleText()).not.toContain(hidden(1));
  });

  it("places the rail right after a leading non-thread pane such as Tomato", async () => {
    const panes = mountSplitDom();
    const root = panes.pa.cell.parentElement!;
    const tomatoPane = document.createElement("div");
    tomatoPane.dataset.splitPaneId = "tomato";
    const tomatoCell = document.createElement("div");
    tomatoCell.style.flex = "0 0 300px";
    tomatoCell.append(tomatoPane);
    const tomatoDivider = document.createElement("div");
    tomatoDivider.dataset.splitResizeGridBoundary = "0";
    root.prepend(tomatoCell, tomatoDivider);
    const layout = splitLayout("pc");
    renderSlot(
      app.appOverlays[0]!,
      {},
      {
        settings: railSettings,
        sidebarSplitLayout: {
          panes: [
            {
              paneId: "tomato",
              threadId: null,
              rect: { x: 0, y: 0, width: 0.2, height: 1 },
              isFocused: false,
            },
            ...layout.panes,
          ],
        },
        sidebarThreads: { threads: [threadA, threadB] },
        pluginId: "pane-collapse",
      },
    );
    act(() => collapsedPanes.set(new Set(["pa", "pb"])));

    const rail = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        "[data-pane-collapse-rail]",
      );
      expect(found).not.toBeNull();
      return found!;
    });
    expect(rail.previousElementSibling).toBe(tomatoDivider);
    expect(rail.nextElementSibling).toBe(panes.pa.cell);
    expect(tomatoCell.nextElementSibling).toBe(tomatoDivider);
    const hidden = (nthChild: number) =>
      `${'[data-pane-collapse-root="0"]'.repeat(3)} > :nth-child(${nthChild}):not(:has([data-maximized])) { display: none !important; }`;
    expect(styleText()).toContain(hidden(4));
    expect(styleText()).toContain(hidden(6));
    expect(styleText()).not.toContain(hidden(1));
  });

  it("previews the thread and sends a quick reply when hovering a rail strip", async () => {
    mountSplitDom();
    mountOverlay("pb", railSettings);
    act(() => collapsedPanes.set(new Set(["pa"])));
    const strip = await screen.findByRole("button", {
      name: "Restore Alpha thread",
    });

    fireEvent.pointerEnter(strip);
    expect(
      await screen.findByText("Plan drafted. Want me to start?"),
    ).toBeDefined();
    expect(screen.getByText("Draft a plan")).toBeDefined();
    expect(
      await screen.findByRole("button", { name: "Context window 25% used" }),
    ).toBeDefined();
    expect(
      screen.getByText(/Waiting for your approval or answer/),
    ).toBeDefined();

    const reply = screen.getByRole("textbox", { name: "Reply" });
    fireEvent.change(reply, { target: { value: "Go ahead" } });
    fireEvent.keyDown(reply, { key: "Enter" });

    await screen.findByText("Sent");
    expect(sentMessages).toEqual([
      {
        threadId: "t-a",
        input: [{ type: "text", text: "Go ahead", mentions: [] }],
        mode: "queue-if-active",
      },
    ]);
    expect(collapsedPanes.get().has("pa")).toBe(true);
  });

  it("restores a pane from its rail strip and removes the rail when none are left", async () => {
    mountSplitDom();
    mountOverlay("pb", railSettings);
    act(() => collapsedPanes.set(new Set(["pa"])));

    fireEvent.click(
      await screen.findByRole("button", { name: "Restore Alpha thread" }),
    );

    expect(collapsedPanes.get().size).toBe(0);
    await waitFor(() =>
      expect(document.querySelector("[data-pane-collapse-rail]")).toBeNull(),
    );
  });

  it("keeps the title bar chips when the setting is the default", async () => {
    mountTitleBar();
    mountSplitDom();
    mountOverlay("pb", { display: "Chips in the title bar" });
    act(() => collapsedPanes.set(new Set(["pa"])));

    await waitFor(() =>
      expect(
        document.querySelector("[data-pane-collapse-tray]"),
      ).not.toBeNull(),
    );
    expect(document.querySelector("[data-pane-collapse-rail]")).toBeNull();
  });
});

describe("minimized threads in the top bar", () => {
  const barSettings = { display: "Horizontal strips on top" };

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pads the bar clear of window controls that float over it", async () => {
    const panes = mountSplitDom();
    const root = panes.pa.cell.parentElement!;
    const controls = document.createElement("div");
    controls.dataset.testid = "app-desktop-sidebar-trigger";
    document.body.append(controls);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const box = (
          left: number,
          top: number,
          right: number,
          bottom: number,
        ) =>
          ({
            left,
            top,
            right,
            bottom,
            width: right - left,
            height: bottom - top,
          }) as DOMRect;
        if (this === controls) return box(84, 8, 170, 32);
        if (this.hasAttribute("data-pane-collapse-bar")) {
          return box(50, 0, 1000, 36);
        }
        return box(0, 0, 0, 0);
      },
    );
    renderSlot(
      app.appOverlays[0]!,
      {},
      {
        settings: barSettings,
        sidebarSplitLayout: splitLayout("pc"),
        sidebarThreads: { threads: [threadA] },
        pluginId: "pane-collapse",
      },
    );
    act(() => collapsedPanes.set(new Set(["pa"])));
    const bar = await waitFor(() => {
      const found = root.parentElement?.querySelector<HTMLElement>(
        "[data-pane-collapse-bar]",
      );
      expect(found).toBeTruthy();
      return found!;
    });
    expect(bar.style.paddingLeft).toBe(`${170 + 8 - 50}px`);
    expect(bar.style.paddingRight).toBe("8px");
    expect(bar.style.height).toBe("40px");
    controls.remove();
  });

  it("puts a full-width bar above the split and lists the most recent first", async () => {
    const panes = mountSplitDom();
    const root = panes.pa.cell.parentElement!;
    renderSlot(
      app.appOverlays[0]!,
      {},
      {
        settings: barSettings,
        sidebarSplitLayout: splitLayout("pc"),
        sidebarThreads: {
          threads: [
            threadA,
            {
              id: "t-b",
              displayTitle: "Beta thread",
              hasPendingInteraction: false,
            } as PluginSidebarThread,
          ],
        },
        pluginId: "pane-collapse",
      },
    );
    act(() => collapsedPanes.set(new Set(["pa", "pb"])));

    const bar = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        "[data-pane-collapse-bar]",
      );
      expect(found).not.toBeNull();
      return found!;
    });
    expect(bar.nextElementSibling).toBe(root);
    expect(bar.parentElement?.hasAttribute("data-pane-collapse-bar-host")).toBe(
      true,
    );
    expect(
      [...bar.querySelectorAll("button")].map((button) => button.title),
    ).toEqual(["Beta thread", "Alpha thread"]);
    expect(document.querySelector("[data-pane-collapse-tray]")).toBeNull();
    expect(document.querySelector("[data-pane-collapse-rail]")).toBeNull();
    expect(styleText()).toContain("flex-direction: column !important");
    expect(styleText()).toContain(
      `${'[data-pane-collapse-root="0"]'.repeat(3)} > :nth-child(1):not(:has([data-maximized])) { display: none !important; }`,
    );
  });

  it("previews the thread and sends a quick reply when hovering a bar strip", async () => {
    mountSplitDom();
    mountOverlay("pb", barSettings);
    act(() => collapsedPanes.set(new Set(["pa"])));
    const strip = await screen.findByRole("button", {
      name: "Restore Alpha thread",
    });

    fireEvent.pointerEnter(strip);
    expect(
      await screen.findByText("Plan drafted. Want me to start?"),
    ).toBeDefined();

    const reply = screen.getByRole("textbox", { name: "Reply" });
    fireEvent.change(reply, { target: { value: "Go ahead" } });
    fireEvent.keyDown(reply, { key: "Enter" });

    await screen.findByText("Sent");
    expect(collapsedPanes.get().has("pa")).toBe(true);
  });

  it("restores a pane from the bar and removes the bar and its styling when none are left", async () => {
    mountSplitDom();
    mountOverlay("pb", barSettings);
    act(() => collapsedPanes.set(new Set(["pa"])));

    fireEvent.click(
      await screen.findByRole("button", { name: "Restore Alpha thread" }),
    );

    expect(collapsedPanes.get().size).toBe(0);
    await waitFor(() =>
      expect(document.querySelector("[data-pane-collapse-bar]")).toBeNull(),
    );
    expect(document.querySelector("[data-pane-collapse-bar-host]")).toBeNull();
    expect(styleText()).not.toContain("flex-direction: column !important");
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
    expect(screen.getByText("Draft a plan")).toBeDefined();
    expect(screen.queryByText("Older ask")).toBeNull();
    const ring = await screen.findByRole("button", {
      name: "Context window 25% used",
    });
    expect(screen.queryByText("75% left")).toBeNull();
    fireEvent.pointerEnter(ring);
    expect(await screen.findByText("25% used")).toBeDefined();
    expect(screen.getByText("75% left")).toBeDefined();
    expect(screen.getByText(/50k \/\s*200k tokens/)).toBeDefined();
    expect(
      screen
        .getByRole("progressbar", { name: "Context window used" })
        .getAttribute("aria-valuenow"),
    ).toBe("25");
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
