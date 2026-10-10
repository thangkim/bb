// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  useBbNavigate,
  useSdk,
  type PluginSidebarSplitLayout,
  type PluginThreadActionItemInput,
} from "@get-bb/plugin-sdk/app";
import { DECORATED_ATTRIBUTE } from "./pane-arrangement";
import { mountMenu, mountPane } from "./test-dom";

const app = await loadPluginApp(() => import("./app"));

type ItemContext = Pick<
  PluginThreadActionItemInput<unknown>,
  "sdk" | "navigate"
>;

function captureItemContext(): ItemContext {
  let context: ItemContext | null = null;
  function Probe() {
    context = { sdk: useSdk(), navigate: useBbNavigate() };
    return null;
  }
  renderSlot({ component: Probe }, {}, { pluginId: "pane-arrangement-menu" });
  if (context === null) throw new Error("probe did not render");
  return context;
}

async function runAction(id: string, threadId: string) {
  const registration = app.threadActions.find(
    (candidate) => candidate.id === id,
  );
  if (registration === undefined) throw new Error(`missing action ${id}`);
  const item = registration.item({
    ...captureItemContext(),
    data: undefined,
    thread: {
      id: threadId,
      projectId: "p",
      parentThreadId: null,
      archivedAt: null,
      pinnedAt: null,
      sectionId: null,
      isUnread: false,
      status: "idle",
      environment: null,
    },
  });
  if (item === null) throw new Error(`hidden action ${id}`);
  await item.run({ requestRename: () => {} });
}

function layout(
  panes: { paneId: string; threadId: string; isFocused: boolean }[],
): PluginSidebarSplitLayout {
  return {
    panes: panes.map((pane) => ({
      ...pane,
      rect: { x: 0, y: 0, width: 1, height: 1 },
    })),
  };
}

function mountHost(splitLayout?: PluginSidebarSplitLayout) {
  return renderSlot(
    app.appOverlays[0]!,
    {},
    {
      pluginId: "pane-arrangement-menu",
      ...(splitLayout === undefined ? {} : { sidebarSplitLayout: splitLayout }),
    },
  );
}

function styleText(): string {
  return [...document.head.querySelectorAll("style")]
    .map((style) => style.textContent)
    .join("\n");
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("registrations", () => {
  it("adds Full Screen and the four moves to the thread menu", () => {
    expect(
      app.threadActions.map((registration) => [
        registration.id,
        registration.title,
      ]),
    ).toEqual([
      ["full-screen", "Full Screen"],
      ["move-left", "Move pane left"],
      ["move-right", "Move pane right"],
      ["move-top", "Move pane to top"],
      ["move-bottom", "Move pane to bottom"],
      ["close-pane", "Close pane"],
    ]);
  });
});

describe("menu host", () => {
  it("hides the core button only while the plugin is mounted", () => {
    const host = mountHost();
    expect(styleText()).toContain(
      "[data-thread-header-pane-actions] > button[aria-pressed] { display: none !important; }",
    );
    expect(styleText()).toContain(
      '[data-thread-header-pane-actions] > button[aria-label="Close pane"] { display: none !important; }',
    );
    host.unmount();
    expect(styleText()).not.toContain("data-thread-header-pane-actions");
  });

  it("decorates thread menus that open after it mounts", async () => {
    mountPane("pa");
    mountHost();
    const { items } = mountMenu("trigger-pa", ["Full Screen"]);
    await waitFor(() =>
      expect(items[0]!.getAttribute(DECORATED_ATTRIBUTE)).toBe("full-screen"),
    );
    expect(items[0]!.textContent).toBe("Full Screen⇧⌘E");
  });

  it("toggles the pane whose header menu was opened when the thread shows in two panes", async () => {
    const a = mountPane("pa");
    const b = mountPane("pb");
    const clickA = vi.fn();
    const clickB = vi.fn();
    a.button.addEventListener("click", clickA);
    b.button.addEventListener("click", clickB);
    mountHost(
      layout([
        { paneId: "pa", threadId: "t-1", isFocused: false },
        { paneId: "pb", threadId: "t-1", isFocused: true },
      ]),
    );
    const { items } = mountMenu("trigger-pa", ["Full Screen"]);
    await waitFor(() =>
      expect(items[0]!.hasAttribute(DECORATED_ATTRIBUTE)).toBe(true),
    );

    await runAction("full-screen", "t-1");

    expect(clickA).toHaveBeenCalledOnce();
    expect(clickB).not.toHaveBeenCalled();
  });

  it("closes the pane whose header menu was opened when the thread shows in two panes", async () => {
    const a = mountPane("pa");
    const b = mountPane("pb");
    const closeA = vi.fn();
    const closeB = vi.fn();
    a.close.addEventListener("click", closeA);
    b.close.addEventListener("click", closeB);
    mountHost(
      layout([
        { paneId: "pa", threadId: "t-1", isFocused: true },
        { paneId: "pb", threadId: "t-1", isFocused: false },
      ]),
    );
    const { items } = mountMenu("trigger-pb", ["Close pane"]);
    await waitFor(() =>
      expect(items[0]!.hasAttribute(DECORATED_ATTRIBUTE)).toBe(true),
    );

    await runAction("close-pane", "t-1");

    expect(closeB).toHaveBeenCalledOnce();
    expect(closeA).not.toHaveBeenCalled();
  });

  it("falls back to the pane showing the thread when no header menu was opened", async () => {
    const a = mountPane("pa");
    const b = mountPane("pb");
    const clickA = vi.fn();
    const clickB = vi.fn();
    a.button.addEventListener("click", clickA);
    b.button.addEventListener("click", clickB);
    mountHost(
      layout([
        { paneId: "pa", threadId: "t-1", isFocused: true },
        { paneId: "pb", threadId: "t-2", isFocused: false },
      ]),
    );

    await runAction("full-screen", "t-2");

    expect(clickB).toHaveBeenCalledOnce();
    expect(clickA).not.toHaveBeenCalled();
  });

  it("does nothing for a thread that is not open in a split pane", async () => {
    const a = mountPane("pa");
    const clickA = vi.fn();
    a.button.addEventListener("click", clickA);
    mountHost(layout([{ paneId: "pa", threadId: "t-1", isFocused: true }]));

    await runAction("full-screen", "t-9");
    await runAction("move-left", "t-9");
    await runAction("close-pane", "t-9");

    expect(clickA).not.toHaveBeenCalled();
  });
});
