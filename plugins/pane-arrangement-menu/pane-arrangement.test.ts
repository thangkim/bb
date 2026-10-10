// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARRANGEMENT_BUTTON_SELECTOR,
  DECORATED_ATTRIBUTE,
  arrangementButtonsForThread,
  decoratePluginMenuItems,
  moveViaArrangementMenu,
  readArrangement,
} from "./pane-arrangement";
import { mountMenu, mountPane } from "./test-dom";

afterEach(() => {
  document.body.replaceChildren();
});

function isHidden(element: HTMLElement): boolean {
  return element.style.getPropertyValue("display") === "none";
}

describe("readArrangement", () => {
  it("splits the shortcut off the button's accessible label", () => {
    const { button } = mountPane("pa");
    expect(readArrangement(button)).toEqual({
      label: "Full Screen",
      shortcut: "⇧⌘E",
      isFullScreen: false,
    });
  });

  it("keeps the whole label when there is no bound shortcut", () => {
    const { button } = mountPane("pa", {
      ariaLabel: "Restore split",
      fullScreen: true,
    });
    expect(readArrangement(button)).toEqual({
      label: "Restore split",
      shortcut: null,
      isFullScreen: true,
    });
  });
});

describe("decoratePluginMenuItems", () => {
  it("labels the item like the hidden button and shows its shortcut in a split pane header menu", () => {
    const { button } = mountPane("pa");
    const { portal, items } = mountMenu("trigger-pa", [
      "Full Screen",
      "Move pane left",
    ]);
    const [fullScreen, moveLeft] = items as [HTMLElement, HTMLElement];

    const result = decoratePluginMenuItems(portal);

    expect(result).toEqual({ found: true, button });
    expect(isHidden(fullScreen)).toBe(false);
    expect(isHidden(moveLeft)).toBe(false);
    expect(fullScreen.textContent).toBe("Full Screen⇧⌘E");
    expect(fullScreen.getAttribute(DECORATED_ATTRIBUTE)).toBe("full-screen");
    expect(moveLeft.getAttribute(DECORATED_ATTRIBUTE)).toBe("left");
  });

  it("offers Exit Full Screen with the restore icon and hides moves while maximized", () => {
    mountPane("pa", { fullScreen: true });
    const { portal, items } = mountMenu("trigger-pa", [
      "Full Screen",
      "Move pane to top",
    ]);
    const [fullScreen, moveTop] = items as [HTMLElement, HTMLElement];

    decoratePluginMenuItems(portal);

    expect(fullScreen.textContent).toBe("Exit Full Screen⇧⌘E");
    const visibleIcons = [
      ...fullScreen.querySelectorAll<HTMLElement>("[data-icon-root]"),
    ].filter((element) => !isHidden(element));
    expect(visibleIcons.map((element) => element.dataset.icon)).toEqual([
      "Minimize2",
    ]);
    expect(isHidden(moveTop)).toBe(true);
  });

  it("hides the items in menus that do not come from a split pane header", () => {
    mountPane("pa");
    const sidebarTrigger = document.createElement("button");
    sidebarTrigger.id = "sidebar-row";
    document.body.append(sidebarTrigger);
    const sidebar = mountMenu("sidebar-row", ["Full Screen"]);
    const drawer = mountMenu(null, ["Move pane right"]);

    expect(decoratePluginMenuItems(sidebar.portal)).toEqual({
      found: true,
      button: null,
    });
    decoratePluginMenuItems(drawer.portal);

    expect(isHidden(sidebar.items[0]!)).toBe(true);
    expect(isHidden(drawer.items[0]!)).toBe(true);
  });

  it("hides the items in the header menu of a pane that is not in a split", () => {
    const { button } = mountPane("pa");
    button.remove();
    const { portal, items } = mountMenu("trigger-pa", ["Full Screen"]);

    decoratePluginMenuItems(portal);

    expect(isHidden(items[0]!)).toBe(true);
  });

  it("shows Close pane only in the header menu of a pane bb can close", () => {
    const closable = mountPane("pa");
    const lastPane = mountPane("pb");
    lastPane.close.remove();
    const a = mountMenu("trigger-pa", ["Close pane"]);
    const b = mountMenu("trigger-pb", ["Close pane"]);
    const drawer = mountMenu(null, ["Close pane"]);

    expect(decoratePluginMenuItems(a.portal)).toEqual({
      found: true,
      button: closable.button,
    });
    decoratePluginMenuItems(b.portal);
    decoratePluginMenuItems(drawer.portal);

    expect(isHidden(a.items[0]!)).toBe(false);
    expect(a.items[0]!.getAttribute(DECORATED_ATTRIBUTE)).toBe("close");
    expect(isHidden(b.items[0]!)).toBe(true);
    expect(isHidden(drawer.items[0]!)).toBe(true);
  });

  it("decorates each item once and leaves other items alone", () => {
    mountPane("pa");
    const { portal, items } = mountMenu("trigger-pa", ["Full Screen"]);

    decoratePluginMenuItems(portal);
    expect(decoratePluginMenuItems(portal).found).toBe(false);

    expect(
      items[0]!.querySelectorAll("[data-pane-arrangement-shortcut]"),
    ).toHaveLength(1);
    expect(portal.querySelectorAll(`[${DECORATED_ATTRIBUTE}]`)).toHaveLength(1);
  });
});

describe("arrangementButtonsForThread", () => {
  it("returns the focused pane showing the thread first", () => {
    const a = mountPane("pa");
    const b = mountPane("pb");
    mountPane("pc");
    const layout = {
      panes: [
        { paneId: "pa", threadId: "t-1", isFocused: false },
        { paneId: "pb", threadId: "t-1", isFocused: true },
        { paneId: "pc", threadId: "t-2", isFocused: false },
      ].map((pane) => ({ ...pane, rect: { x: 0, y: 0, width: 1, height: 1 } })),
    };

    expect(arrangementButtonsForThread(layout, "t-1")).toEqual([
      b.button,
      a.button,
    ]);
    expect(arrangementButtonsForThread(null, "t-1")).toEqual([]);
  });
});

describe("moveViaArrangementMenu", () => {
  function openMenuOnArrowDown(
    button: HTMLButtonElement,
    labels: string[],
    onSelect: (label: string) => void,
  ) {
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown") return;
      window.setTimeout(() => {
        const menu = document.createElement("div");
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", "Pane arrangement");
        for (const label of labels) {
          const item = document.createElement("button");
          item.setAttribute("role", "menuitem");
          item.setAttribute("aria-label", label);
          item.addEventListener("click", () => onSelect(label));
          menu.append(item);
        }
        document.body.append(menu);
      }, 5);
    });
  }

  it("opens the hidden arrangement menu and picks the side", async () => {
    const { button } = mountPane("pa");
    const onSelect = vi.fn();
    openMenuOnArrowDown(button, ["Move left", "Move bottom"], onSelect);

    await expect(moveViaArrangementMenu(button, "bottom")).resolves.toBe(true);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("Move bottom");
  });

  it("gives up when the menu has no move for the pane", async () => {
    const { button } = mountPane("pa");
    const onSelect = vi.fn();
    openMenuOnArrowDown(button, [], onSelect);

    await expect(moveViaArrangementMenu(button, "left", 50)).resolves.toBe(
      false,
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does nothing while the pane is maximized", async () => {
    const { button } = mountPane("pa", { fullScreen: true });
    const keydown = vi.fn();
    button.addEventListener("keydown", keydown);

    await expect(moveViaArrangementMenu(button, "left")).resolves.toBe(false);
    expect(keydown).not.toHaveBeenCalled();
  });
});

it("targets only the pane arrangement button, not the close button", () => {
  const { pane, button } = mountPane("pa");
  expect([...pane.querySelectorAll(ARRANGEMENT_BUTTON_SELECTOR)]).toEqual([
    button,
  ]);
});
