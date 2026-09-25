// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { toast } from "sonner";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  ExperimentalSplitPaneNewThreadOptions,
  ExperimentalSplitPaneOpenResult,
  PluginAppBuilder,
  PluginCommandContext,
  PluginCommandRegistration,
} from "@get-bb/plugin-sdk/app";

vi.mock("sonner", () => ({ toast: vi.fn() }));

const app = await loadPluginApp(() => import("./app"));
const { default: definition, PANE_CAP_MESSAGE } = await import("./app");

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

function mountController(
  isAvailable: boolean,
  result: ExperimentalSplitPaneOpenResult = "opened",
) {
  const openNewThread = vi.fn(
    (_options: ExperimentalSplitPaneNewThreadOptions) => result,
  );
  const overlay = app.appOverlays[0]!;
  const view = renderSlot(
    overlay,
    {},
    { experimental_splitPanes: { isAvailable, openNewThread } },
  );
  return { openNewThread, view };
}

beforeEach(() => {
  vi.mocked(toast).mockClear();
});

afterEach(cleanup);

describe("registration", () => {
  it("mounts one controller overlay", () => {
    expect(app.appOverlays.map((overlay) => overlay.id)).toEqual([
      "controller",
    ]);
  });

  it("registers the split commands on Alt+A/D/W/S and new-thread-beside unbound", () => {
    expect(
      [...commands.values()].map(({ id, title, defaultShortcut }) => ({
        id,
        title,
        defaultShortcut,
      })),
    ).toEqual([
      {
        id: "split-left",
        title: "Panes: split new thread left",
        defaultShortcut: { key: "a", alt: true },
      },
      {
        id: "split-right",
        title: "Panes: split new thread right",
        defaultShortcut: { key: "d", alt: true },
      },
      {
        id: "split-up",
        title: "Panes: split new thread up",
        defaultShortcut: { key: "w", alt: true },
      },
      {
        id: "split-down",
        title: "Panes: split new thread down",
        defaultShortcut: { key: "s", alt: true },
      },
      {
        id: "new-thread-beside",
        title: "Panes: new thread beside the focused pane",
        defaultShortcut: undefined,
      },
    ]);
  });
});

describe("split commands", () => {
  it("are unavailable before the controller mounts", () => {
    expect(command("split-left").isAvailable?.(context)).toBe(false);
    expect(command("new-thread-beside").isAvailable?.(context)).toBe(false);
  });

  it("are unavailable when splits are", () => {
    mountController(false);
    expect(command("split-right").isAvailable?.(context)).toBe(false);
    expect(command("new-thread-beside").isAvailable?.(context)).toBe(true);
  });

  it.each([
    ["split-left", "left"],
    ["split-right", "right"],
    ["split-up", "top"],
    ["split-down", "bottom"],
  ] as const)("%s opens a composer on the %s side", (id, side) => {
    const { openNewThread } = mountController(true);

    expect(command(id).isAvailable?.(context)).toBe(true);
    command(id).run(context);

    expect(openNewThread).toHaveBeenCalledWith({ side });
    expect(toast).not.toHaveBeenCalled();
  });

  it("toasts at the pane cap", () => {
    mountController(true, "at-cap");

    command("split-down").run(context);

    expect(toast).toHaveBeenCalledWith(PANE_CAP_MESSAGE);
    expect(PANE_CAP_MESSAGE).toBe("Can't split — 8 panes is the maximum.");
  });

  it("stops acting once the controller unmounts", () => {
    const { openNewThread, view } = mountController(true);
    view.unmount();

    expect(command("split-left").isAvailable?.(context)).toBe(false);
    command("split-left").run(context);
    expect(openNewThread).not.toHaveBeenCalled();
  });
});

describe("new-thread-beside", () => {
  it("reuses a matching composer, else opens one to the right and replaces the focused pane at the cap", () => {
    const { openNewThread, view } = mountController(true, "replaced");

    command("new-thread-beside").run(context);

    expect(openNewThread).toHaveBeenCalledWith({
      side: "right",
      atPaneCap: "replace",
      reuseComposer: true,
    });
    expect(view.inspection.navigateCalls).toEqual([]);
    expect(toast).not.toHaveBeenCalled();
  });

  it("falls back to the compose screen when splits are unavailable", () => {
    const { view } = mountController(false, "unavailable");

    command("new-thread-beside").run(context);

    expect(view.inspection.navigateCalls).toEqual([
      { method: "toCompose", options: { focusPrompt: true } },
    ]);
  });
});
