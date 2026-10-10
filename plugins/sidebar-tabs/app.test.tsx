// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  ExperimentalSidebarNavigationItem,
  ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import {
  EXPANDED_ATTRIBUTE,
  PANEL_ATTRIBUTE,
  PANELS_CHANGED_EVENT,
  adjacentTab,
  parseTab,
} from "./tabs";

const app = await loadPluginApp(() => import("./app"));
const { tabStore } = await import("./app");
const navigation = app.experimentalSidebarNavigations[0]!;

const PROPS: ExperimentalSidebarNavigationProps = {
  isCompactViewport: false,
  experimental_Original: () => null,
};

function item(
  id: string,
  label: string,
  overrides: Partial<ExperimentalSidebarNavigationItem> = {},
): ExperimentalSidebarNavigationItem {
  return {
    id,
    label,
    icon: { kind: "plugin", pluginId: "demo", icon: null },
    action: { kind: "plugin-panel", pluginId: "demo", panelId: id },
    isDisabled: false,
    isVisible: true,
    isLoading: false,
    pluginId: "demo",
    shortcut: null,
    experimental_Accessory: null,
    ...overrides,
  } as ExperimentalSidebarNavigationItem;
}

const ITEMS = [
  item("__bb__/search-threads", "Search threads", {
    icon: { kind: "host", name: "search" },
    action: { kind: "search-threads" },
    pluginId: null,
  }),
  item("my-tasks/tasks", "My Tasks"),
  item("linear/linear", "Linear", { isVisible: false }),
];

function renderTabs() {
  return renderSlot(navigation, PROPS, {
    sidebarNavigation: { items: ITEMS, activeItemId: "my-tasks/tasks" },
  });
}

function tab(name: string): HTMLElement {
  return screen.getByRole("tab", { name });
}

beforeEach(() => {
  window.localStorage.clear();
  tabStore.set("threads");
});
afterEach(cleanup);

describe("tab helpers", () => {
  it("falls back to Threads for unknown stored values", () => {
    expect(parseTab("projects")).toBe("projects");
    expect(parseTab("inbox")).toBe("threads");
    expect(parseTab(null)).toBe("threads");
  });

  it("wraps around when moving between tabs", () => {
    expect(adjacentTab("projects", -1)).toBe("more");
    expect(adjacentTab("more", 1)).toBe("projects");
  });
});

describe("sidebar tabs", () => {
  it("shows Projects, Threads, and More with Threads selected by default", () => {
    renderTabs();
    expect(
      screen.getAllByRole("tab").map((element) => element.dataset.sidebarTab),
    ).toEqual(["projects", "threads", "more"]);
    expect(tab("Threads").getAttribute("aria-selected")).toBe("true");
  });

  it("mounts a tab's content only while that tab is selected", () => {
    renderTabs();
    expect(screen.queryByTestId("sidebar-tabs-navigation")).toBeNull();
    expect(document.querySelector(`[${PANEL_ATTRIBUTE}]`)).toBeNull();
    fireEvent.click(tab("More"));
    expect(screen.queryByTestId("sidebar-tabs-navigation")).not.toBeNull();
    expect(document.querySelector(`[${PANEL_ATTRIBUTE}]`)).toBeNull();
    fireEvent.click(tab("Projects"));
    expect(screen.queryByTestId("sidebar-tabs-navigation")).toBeNull();
    expect(
      document.querySelector(`[${PANEL_ATTRIBUTE}="projects"]`),
    ).not.toBeNull();
  });

  it("remembers the chosen tab", () => {
    renderTabs();
    fireEvent.click(tab("Projects"));
    expect(tab("Projects").getAttribute("aria-selected")).toBe("true");
    expect(
      window.localStorage.getItem("bb-plugin-sidebar-tabs:active-tab"),
    ).toBe("projects");
  });

  it("moves between tabs with the arrow keys", () => {
    renderTabs();
    tab("Threads").focus();
    fireEvent.keyDown(tab("Threads"), { key: "ArrowRight" });
    expect(tab("More").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("More"));
    fireEvent.keyDown(tab("More"), { key: "ArrowRight" });
    expect(tab("Projects").getAttribute("aria-selected")).toBe("true");
  });

  it("expands the navigation region and hides the thread list outside Threads", () => {
    const region = document.createElement("nav");
    region.dataset.testid = "sidebar-navigation-region";
    document.body.append(region);
    const slot = renderTabs();
    region.append(slot.container);
    expect(region.hasAttribute(EXPANDED_ATTRIBUTE)).toBe(false);
    fireEvent.click(tab("Projects"));
    expect(region.hasAttribute(EXPANDED_ATTRIBUTE)).toBe(true);
    fireEvent.click(tab("Threads"));
    expect(region.hasAttribute(EXPANDED_ATTRIBUTE)).toBe(false);
    const style = [...document.head.querySelectorAll("style")].find((element) =>
      element.textContent?.includes(
        `[${EXPANDED_ATTRIBUTE}] ~ [data-sidebar="content"]`,
      ),
    );
    expect(style).toBeDefined();
    slot.unmount();
    region.remove();
  });

  it("announces the Projects panel when it opens and closes so another plugin can fill it", async () => {
    const listener = vi.fn();
    window.addEventListener(PANELS_CHANGED_EVENT, listener);
    renderTabs();
    expect(listener).not.toHaveBeenCalled();
    fireEvent.click(tab("Projects"));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector(`[${PANEL_ATTRIBUTE}="projects"]`),
    ).not.toBeNull();
    fireEvent.click(tab("Threads"));
    await act(async () => {});
    expect(listener).toHaveBeenCalledTimes(2);
    expect(document.querySelector(`[${PANEL_ATTRIBUTE}]`)).toBeNull();
    window.removeEventListener(PANELS_CHANGED_EVENT, listener);
  });

  it("lists visible and hidden navigation items in More and activates them", () => {
    const slot = renderTabs();
    fireEvent.click(tab("More"));
    const rows = screen
      .getByTestId("sidebar-tabs-navigation")
      .querySelectorAll("[data-sidebar-navigation-item]");
    expect(
      [...rows].map((row) => row.getAttribute("data-sidebar-navigation-item")),
    ).toEqual(["__bb__/search-threads", "my-tasks/tasks", "linear/linear"]);
    expect(
      screen
        .getByRole("button", { name: "My Tasks" })
        .getAttribute("aria-current"),
    ).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Linear" }), {
      metaKey: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Customize sidebar" }));
    expect(slot.sidebarNavigationCalls).toEqual([
      { method: "activate", itemId: "linear/linear", openInSplit: true },
      { method: "openCustomize" },
    ]);
  });
});
