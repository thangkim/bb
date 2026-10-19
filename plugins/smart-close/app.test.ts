// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPluginApp,
  mountPluginContentScripts,
  type MountedPluginContentScripts,
} from "@get-bb/plugin-sdk/testing/app";
import { FOCUS_SETTLE_MS } from "./smart-close";

const app = await loadPluginApp(() => import("./app"));
let mounted: MountedPluginContentScripts | null = null;
let paneCloses: KeyboardEvent[] = [];

function recordPaneClose(event: KeyboardEvent): void {
  if (event.key === "X" && event.shiftKey) paneCloses.push(event);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["performance"] });
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  paneCloses = [];
  window.addEventListener("keydown", recordPaneClose);
});

afterEach(async () => {
  await mounted?.lifecycle.dispose();
  mounted = null;
  window.removeEventListener("keydown", recordPaneClose);
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mount(): Promise<MountedPluginContentScripts> {
  mounted = await mountPluginContentScripts(app, { pluginId: "smart-close" });
  return mounted;
}

interface Layout {
  composer: HTMLTextAreaElement;
  panel: HTMLElement;
  tabLabel: HTMLSpanElement;
  terminal: HTMLTextAreaElement;
}

function renderThread(): Layout {
  const composer = document.createElement("textarea");
  const panel = document.createElement("aside");
  const toolbar = document.createElement("div");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Right panel views");
  const tabLabel = document.createElement("span");
  tabLabel.textContent = "localhost:3000";
  toolbar.append(tabLabel);
  const terminal = document.createElement("textarea");
  panel.append(toolbar, terminal);
  document.body.append(composer, panel);
  return { composer, panel, tabLabel, terminal };
}

function pointerDown(target: Element): void {
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
}

function pressCloseKey(
  target: Element,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "w",
    code: "KeyW",
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("smart close", () => {
  it("turns Cmd+W outside the right panel into bb's pane close shortcut", async () => {
    const { composer } = renderThread();
    await mount();
    composer.focus();

    const event = pressCloseKey(composer);

    expect(event.defaultPrevented).toBe(true);
    expect(paneCloses).toHaveLength(1);
    expect(paneCloses[0]).toMatchObject({
      code: "KeyX",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    });
  });

  it("lets Cmd+W reach bb's panel close after a click on a right-panel tab", async () => {
    const { tabLabel } = renderThread();
    await mount();

    pointerDown(tabLabel);
    const event = pressCloseKey(document.body);

    expect(event.defaultPrevented).toBe(false);
    expect(paneCloses).toHaveLength(0);
  });

  it("keeps the panel active when bb moves focus out right after the click", async () => {
    const { composer, tabLabel } = renderThread();
    await mount();

    pointerDown(tabLabel);
    vi.advanceTimersByTime(FOCUS_SETTLE_MS - 100);
    composer.focus();

    expect(pressCloseKey(composer).defaultPrevented).toBe(false);
  });

  it("keeps closing panel tabs when focus lands outside after each close", async () => {
    const { composer, tabLabel } = renderThread();
    await mount();

    pointerDown(tabLabel);
    vi.advanceTimersByTime(FOCUS_SETTLE_MS * 2);
    pressCloseKey(document.body);
    composer.focus();

    expect(pressCloseKey(composer).defaultPrevented).toBe(false);
    expect(paneCloses).toHaveLength(0);
  });

  it("follows keyboard focus that later leaves the panel", async () => {
    const { composer, terminal } = renderThread();
    await mount();

    terminal.focus();
    expect(pressCloseKey(terminal).defaultPrevented).toBe(false);

    vi.advanceTimersByTime(FOCUS_SETTLE_MS * 2);
    composer.focus();

    expect(pressCloseKey(composer).defaultPrevented).toBe(true);
    expect(paneCloses).toHaveLength(1);
  });

  it("treats a hidden right panel as inactive", async () => {
    const { panel, tabLabel } = renderThread();
    await mount();

    pointerDown(tabLabel);
    panel.setAttribute("aria-hidden", "true");

    expect(pressCloseKey(document.body).defaultPrevented).toBe(true);
    expect(paneCloses).toHaveLength(1);
  });

  it("ignores asides that are not bb's right panel", async () => {
    renderThread();
    const other = document.createElement("aside");
    const button = document.createElement("button");
    other.append(button);
    document.body.append(other);
    await mount();

    pointerDown(button);

    expect(pressCloseKey(button).defaultPrevented).toBe(true);
  });

  it("swallows auto-repeat outside the panel without closing more panes", async () => {
    const { composer } = renderThread();
    await mount();

    expect(pressCloseKey(composer, { repeat: true }).defaultPrevented).toBe(
      true,
    );
    expect(paneCloses).toHaveLength(0);
  });

  it("leaves other shortcuts and open modals to bb", async () => {
    const { composer } = renderThread();
    await mount();

    expect(pressCloseKey(composer, { shiftKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(
      pressCloseKey(composer, { metaKey: false, ctrlKey: true })
        .defaultPrevented,
    ).toBe(false);

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    document.body.append(dialog);

    expect(pressCloseKey(composer).defaultPrevented).toBe(false);
    expect(paneCloses).toHaveLength(0);
  });

  it("uses Ctrl off macOS", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    const { composer } = renderThread();
    await mount();

    expect(
      pressCloseKey(composer, { metaKey: false, ctrlKey: true })
        .defaultPrevented,
    ).toBe(true);
    expect(paneCloses[0]).toMatchObject({ ctrlKey: true, metaKey: false });
  });

  it("stops intercepting once disposed", async () => {
    const { composer } = renderThread();
    const scripts = await mount();
    await scripts.lifecycle.dispose();
    mounted = null;

    expect(pressCloseKey(composer).defaultPrevented).toBe(false);
  });
});
