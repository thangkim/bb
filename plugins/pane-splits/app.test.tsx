// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { toast } from "sonner";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  PluginAppBuilder,
  PluginBrowserBbSdk,
  PluginSidebarSplitLayout,
  PluginCommandContext,
  PluginCommandRegistration,
} from "@get-bb/plugin-sdk/app";

vi.mock("sonner", () => ({ toast: vi.fn() }));

const app = await loadPluginApp(() => import("./app"));
const {
  default: definition,
  NOTHING_TO_REOPEN_MESSAGE,
  PANE_CAP_MESSAGE,
} = await import("./app");

const commands = new Map<string, PluginCommandRegistration>();
definition.setup({
  commands: {
    register: (registration: PluginCommandRegistration) => {
      commands.set(registration.id, registration);
    },
  },
  slots: { experimental_appOverlay: () => {} },
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

type Pane = PluginSidebarSplitLayout["panes"][number];

function pane(
  paneId: string,
  threadId: string | null,
  x: number,
  width: number,
  isFocused = false,
): Pane {
  return {
    paneId,
    threadId,
    rect: { x, y: 0, width, height: 1 },
    isFocused,
  };
}

function mountController(
  host: {
    sidebarSplitLayout?: PluginSidebarSplitLayout;
    threadId?: string;
    projectId?: string;
    environmentId?: string | null;
    open?: () => Promise<{ delivered: number }>;
  } = {},
) {
  const overlay = app.appOverlays[0]!;
  return renderSlot(
    overlay,
    {},
    {
      ...(host.sidebarSplitLayout === undefined
        ? {}
        : { sidebarSplitLayout: host.sidebarSplitLayout }),
      context: {
        threadId: host.threadId ?? null,
        projectId: host.projectId ?? null,
      },
      sdk: {
        threads: {
          open: host.open ?? (async () => ({ delivered: 1 })),
          get: (async ({ threadId }: { threadId: string }) => ({
            id: threadId,
            environmentId: host.environmentId ?? null,
          })) as unknown as PluginBrowserBbSdk["threads"]["get"],
        },
      },
    },
  );
}

function opens(view: ReturnType<typeof mountController>) {
  return view.inspection.sdkCalls.filter(
    (call) => call.method === "threads.open",
  );
}

function closeRightPaneOf(left: string, right: string): void {
  mountController({
    sidebarSplitLayout: {
      panes: [pane("p1", left, 0, 0.5, true), pane("p2", right, 0.5, 0.5)],
    },
    threadId: left,
  });
  cleanup();
}

interface HostClick {
  href: string | null;
  metaKey: boolean;
  button: number;
}

const hostClicks: HostClick[] = [];
let hostOpensSplits = true;

function hostRouteAnchorDelegate(event: MouseEvent): void {
  if (!(event.target instanceof HTMLAnchorElement)) return;
  hostClicks.push({
    href: event.target.getAttribute("href"),
    metaKey: event.metaKey,
    button: event.button,
  });
  if (hostOpensSplits) event.preventDefault();
}

beforeEach(() => {
  vi.mocked(toast).mockClear();
  hostClicks.length = 0;
  hostOpensSplits = true;
  document.addEventListener("click", hostRouteAnchorDelegate);
});

afterEach(() => {
  document.removeEventListener("click", hostRouteAnchorDelegate);
  cleanup();
});

describe("registration", () => {
  it("mounts the controller and split-tabs overlays", () => {
    expect(app.appOverlays.map((overlay) => overlay.id)).toEqual([
      "controller",
      "split-tabs",
    ]);
  });

  it("registers only the right split on Alt+D and reopen on Mod+Alt+T", () => {
    expect(
      [...commands.values()].map(({ id, title, defaultShortcut }) => ({
        id,
        title,
        defaultShortcut,
      })),
    ).toEqual([
      {
        id: "split-right",
        title: "Panes: new thread on the right",
        defaultShortcut: { key: "d", alt: true },
      },
      {
        id: "reopen-closed",
        title: "Panes: reopen closed thread",
        defaultShortcut: { key: "t", mod: true, alt: true },
      },
    ]);
  });
});

describe("split-right", () => {
  it("is unavailable before the controller mounts", () => {
    expect(command("split-right").isAvailable?.(context)).toBe(false);
  });

  it("asks bb to open its composer beside the focused pane, then selects the focused project and focuses the prompt", () => {
    const view = mountController({
      threadId: "thr_focused",
      projectId: "proj_focused",
    });

    expect(command("split-right").isAvailable?.(context)).toBe(true);
    command("split-right").run(context);

    expect(hostClicks).toEqual([{ href: "/", metaKey: true, button: 0 }]);
    expect(view.inspection.navigateCalls).toEqual([
      {
        method: "toCompose",
        options: { projectId: "proj_focused", focusPrompt: true },
      },
    ]);
  });

  it("opens the composer with the focused thread's side panel so the panel stays open", () => {
    const sourceKey = "bb.thread.fixedPanelTabsState-thr_focused-1";
    const composerKey = "bb.thread.fixedPanelTabsState-root-compose-1";
    const browser = {
      id: "browser:docs:env_1",
      kind: "browser",
      environmentId: "env_1",
      title: "App",
      url: "http://localhost:3000/settings",
    };
    window.localStorage.setItem(
      sourceKey,
      JSON.stringify({
        version: 1,
        secondary: { tabs: [browser], activeTabId: browser.id, isOpen: true },
        lastUsedAt: 1,
      }),
    );
    const announced: (string | null)[] = [];
    const listen = (event: StorageEvent) => announced.push(event.key);
    window.addEventListener("storage", listen);
    try {
      mountController({ threadId: "thr_focused" });
      command("split-right").run(context);
      const copy = { ...browser, id: "browser:docs%40root-compose:env_1" };
      expect(
        JSON.parse(window.localStorage.getItem(composerKey)!).secondary,
      ).toEqual({ tabs: [copy], activeTabId: copy.id, isOpen: true });
      expect(announced).toEqual([composerKey]);
    } finally {
      window.removeEventListener("storage", listen);
      window.localStorage.clear();
    }
  });

  it("reuses the focused thread's environment so the composer's browser tabs can load", async () => {
    const view = mountController({
      threadId: "thr_focused",
      projectId: "proj_focused",
      environmentId: "env_focused",
    });
    await vi.waitFor(() => {
      command("split-right").run(context);
      expect(view.inspection.navigateCalls.at(-1)).toEqual({
        method: "toCompose",
        options: {
          projectId: "proj_focused",
          environmentId: "env_focused",
          focusPrompt: true,
        },
      });
    });
  });

  it("leaves the composer's project alone when the focused pane has none", () => {
    const view = mountController();

    command("split-right").run(context);

    expect(view.inspection.navigateCalls).toEqual([
      { method: "toCompose", options: { focusPrompt: true } },
    ]);
  });

  it("still opens the composer when bb ignores the split request", () => {
    hostOpensSplits = false;
    const view = mountController({ projectId: "proj_focused" });

    command("split-right").run(context);

    expect(hostClicks).toHaveLength(1);
    expect(view.inspection.navigateCalls).toEqual([
      {
        method: "toCompose",
        options: { projectId: "proj_focused", focusPrompt: true },
      },
    ]);
  });

  it("stops acting once the controller unmounts", () => {
    const view = mountController();
    view.unmount();

    expect(command("split-right").isAvailable?.(context)).toBe(false);
    command("split-right").run(context);
    expect(hostClicks).toEqual([]);
    expect(view.inspection.navigateCalls).toEqual([]);
  });
});

describe("reopen-closed", () => {
  it("reopens the closed thread on the side it was closed from, once", async () => {
    closeRightPaneOf("left-thread", "right-thread");
    const view = mountController({ threadId: "left-thread" });

    await command("reopen-closed").run(context);

    expect(opens(view)).toEqual([
      {
        method: "threads.open",
        args: [{ threadId: "right-thread", split: "right", file: null }],
      },
    ]);
    expect(view.inspection.navigateCalls).toEqual([]);

    await command("reopen-closed").run(context);

    expect(opens(view)).toHaveLength(1);
    expect(toast).toHaveBeenCalledWith(NOTHING_TO_REOPEN_MESSAGE);
  });

  it("maps a pane closed below the focused one to bb's down split", async () => {
    mountController({
      sidebarSplitLayout: {
        panes: [
          {
            paneId: "p1",
            threadId: "top-thread",
            rect: { x: 0, y: 0, width: 1, height: 0.5 },
            isFocused: true,
          },
          {
            paneId: "p2",
            threadId: "bottom-thread",
            rect: { x: 0, y: 0.5, width: 1, height: 0.5 },
            isFocused: false,
          },
        ],
      },
      threadId: "top-thread",
    });
    cleanup();
    const view = mountController({ threadId: "top-thread" });

    await command("reopen-closed").run(context);

    expect(opens(view)).toEqual([
      {
        method: "threads.open",
        args: [{ threadId: "bottom-thread", split: "down", file: null }],
      },
    ]);
  });

  it("keeps the closed thread for later when the layout is at the pane cap", async () => {
    closeRightPaneOf("left-thread", "right-thread");
    mountController({ threadId: "left-thread" });
    cleanup();
    const full = mountController({
      sidebarSplitLayout: {
        panes: Array.from({ length: 8 }, (_, index) =>
          pane(`full-${index}`, `open-${index}`, index / 8, 1 / 8, index === 0),
        ),
      },
      threadId: "open-0",
    });

    await command("reopen-closed").run(context);

    expect(toast).toHaveBeenCalledWith(PANE_CAP_MESSAGE);
    expect(opens(full)).toEqual([]);
    cleanup();

    const view = mountController({ threadId: "left-thread" });
    await command("reopen-closed").run(context);

    expect(opens(view)).toEqual([
      {
        method: "threads.open",
        args: [{ threadId: "right-thread", split: "right", file: null }],
      },
    ]);
  });

  it("reports a failed open", async () => {
    closeRightPaneOf("left-thread", "right-thread");
    mountController({
      threadId: "left-thread",
      open: async () => {
        throw new Error("Thread not found");
      },
    });

    await command("reopen-closed").run(context);

    expect(toast).toHaveBeenCalledWith(
      "Couldn't reopen the thread: Thread not found",
    );
  });
});
