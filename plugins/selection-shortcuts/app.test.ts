// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPluginApp,
  mountPluginContentScripts,
  type MountedPluginContentScripts,
} from "@get-bb/plugin-sdk/testing/app";
import { SHORTCUT_HINT_ATTRIBUTE } from "./selection-shortcuts";

const app = await loadPluginApp(() => import("./app"));
let mounted: MountedPluginContentScripts | null = null;

afterEach(async () => {
  await mounted?.lifecycle.dispose();
  mounted = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function mount(): Promise<MountedPluginContentScripts> {
  mounted = await mountPluginContentScripts(app, {
    pluginId: "selection-shortcuts",
  });
  return mounted;
}

function flushObservers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function actionButton(label: string, onClick: () => void): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "flex items-center";
  const button = document.createElement("button");
  button.type = "button";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("aria-hidden", "true");
  button.append(icon, document.createTextNode(label));
  button.addEventListener("click", onClick);
  row.append(button);
  return row;
}

function openSelectionMenu(
  labels: readonly string[] = ["Add to chat", "Reply in side chat"],
  onClick: (label: string) => void = () => {},
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-radix-popper-content-wrapper", "");
  const content = document.createElement("div");
  content.setAttribute("role", "dialog");
  content.setAttribute("data-state", "open");
  content.setAttribute("data-bb-portaled-overlay", "");
  for (const label of labels) {
    content.append(actionButton(label, () => onClick(label)));
  }
  wrapper.append(content);
  document.body.append(wrapper);
  return wrapper;
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  if (match === undefined) throw new Error(`missing ${label}`);
  return match;
}

function press(
  key: string,
  init: KeyboardEventInit = {},
  target: EventTarget = document.body,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("selection menu shortcuts", () => {
  it("clicks Add to chat on A and Reply in side chat on R, consuming the key", async () => {
    const clicked: string[] = [];
    openSelectionMenu(undefined, (label) => clicked.push(label));
    await mount();
    const bubbled = vi.fn();
    window.addEventListener("keydown", bubbled);

    const addEvent = press("a");
    const replyEvent = press("R", { shiftKey: true });

    window.removeEventListener("keydown", bubbled);
    expect(clicked).toEqual(["Add to chat", "Reply in side chat"]);
    expect(addEvent.defaultPrevented).toBe(true);
    expect(replyEvent.defaultPrevented).toBe(true);
    expect(bubbled).not.toHaveBeenCalled();
  });

  it.each([
    ["Meta", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Alt", { altKey: true }],
    ["repeat", { repeat: true }],
    ["IME composition", { isComposing: true }],
  ])("ignores A with %s", async (_name, init) => {
    const onClick = vi.fn();
    openSelectionMenu(undefined, onClick);
    await mount();

    const event = press("a", init);

    expect(onClick).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([
    ["input", () => document.createElement("input")],
    ["textarea", () => document.createElement("textarea")],
    [
      "contenteditable",
      () => {
        const editor = document.createElement("div");
        editor.setAttribute("contenteditable", "true");
        editor.tabIndex = 0;
        return editor;
      },
    ],
  ])("ignores A while typing in a %s", async (_name, create) => {
    const onClick = vi.fn();
    openSelectionMenu(undefined, onClick);
    await mount();
    const editable = create();
    document.body.append(editable);
    editable.focus();

    const event = press("a", {}, editable);

    expect(onClick).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores keys when no selection menu is open or the action is absent", async () => {
    const onClick = vi.fn();
    const menu = openSelectionMenu(["Add to chat"], onClick);
    menu.firstElementChild!.setAttribute("data-state", "closed");
    await mount();

    expect(press("a").defaultPrevented).toBe(false);
    menu.firstElementChild!.setAttribute("data-state", "open");
    expect(press("r").defaultPrevented).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
    expect(press("a").defaultPrevented).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not match same-labelled buttons outside the selection menu", async () => {
    const onClick = vi.fn();
    document.body.append(actionButton("Add to chat", onClick));
    const menuLike = document.createElement("div");
    menuLike.setAttribute("role", "menu");
    menuLike.setAttribute("data-state", "open");
    menuLike.append(actionButton("Add to chat", onClick));
    document.body.append(menuLike);
    await mount();

    expect(press("a").defaultPrevented).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
    expect(document.querySelector(`[${SHORTCUT_HINT_ATTRIBUTE}]`)).toBeNull();
  });

  it("marks shortcut buttons with hints that follow menu and focus changes", async () => {
    await mount();
    const menu = openSelectionMenu([
      "Add to chat",
      "Copy",
      "Reply in side chat",
    ]);
    await flushObservers();

    expect(button("Add to chat").getAttribute(SHORTCUT_HINT_ATTRIBUTE)).toBe(
      "A",
    );
    expect(button("Add to chat").getAttribute("aria-keyshortcuts")).toBe("A");
    expect(
      button("Reply in side chat").getAttribute(SHORTCUT_HINT_ATTRIBUTE),
    ).toBe("R");
    expect(button("Copy").hasAttribute(SHORTCUT_HINT_ATTRIBUTE)).toBe(false);

    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    textarea.focus();
    await flushObservers();
    expect(document.querySelector(`[${SHORTCUT_HINT_ATTRIBUTE}]`)).toBeNull();
    expect(document.querySelector("[aria-keyshortcuts]")).toBeNull();

    textarea.blur();
    await flushObservers();
    expect(button("Add to chat").getAttribute(SHORTCUT_HINT_ATTRIBUTE)).toBe(
      "A",
    );

    menu.firstElementChild!.setAttribute("data-state", "closed");
    await flushObservers();
    expect(document.querySelector(`[${SHORTCUT_HINT_ATTRIBUTE}]`)).toBeNull();
  });

  it("hints buttons added to an already open menu", async () => {
    const menu = openSelectionMenu(["Add to chat"]);
    await mount();
    expect(button("Add to chat").getAttribute(SHORTCUT_HINT_ATTRIBUTE)).toBe(
      "A",
    );

    menu.firstElementChild!.append(
      actionButton("Reply in side chat", () => {}),
    );
    await flushObservers();

    expect(button("Reply in side chat").getAttribute("aria-keyshortcuts")).toBe(
      "R",
    );
  });

  it("removes every hint and stops handling keys after dispose", async () => {
    const onClick = vi.fn();
    openSelectionMenu(undefined, onClick);
    const scripts = await mount();
    expect(
      document.querySelectorAll(`[${SHORTCUT_HINT_ATTRIBUTE}]`),
    ).toHaveLength(2);

    await scripts.lifecycle.dispose();
    mounted = null;

    expect(scripts.inspection.signal.aborted).toBe(true);
    expect(document.querySelector(`[${SHORTCUT_HINT_ATTRIBUTE}]`)).toBeNull();
    expect(document.querySelector("[aria-keyshortcuts]")).toBeNull();
    expect(press("a").defaultPrevented).toBe(false);
    expect(onClick).not.toHaveBeenCalled();

    openSelectionMenu();
    await flushObservers();
    expect(document.querySelector(`[${SHORTCUT_HINT_ATTRIBUTE}]`)).toBeNull();
  });
});
