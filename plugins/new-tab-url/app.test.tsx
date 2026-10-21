// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
  type MountedPluginContentScripts,
  type RenderedSlot,
} from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app.js"));
const banner = app.composerCustomizations[0]?.banners?.[0];

let mounted: MountedPluginContentScripts | null = null;
let slots: RenderedSlot[] = [];

beforeEach(() => {
  if (banner === undefined) throw new Error("banner not registered");
});

afterEach(async () => {
  await mounted?.lifecycle.dispose();
  mounted = null;
  for (const slot of slots) slot.unmount();
  slots = [];
  document.body.replaceChildren();
});

function renderOpener(openUrl: (url: string) => boolean): RenderedSlot {
  const slot = renderSlot(banner!, {}, { openUrl });
  slots.push(slot);
  return slot;
}

function addPane(): { pane: HTMLElement; input: HTMLInputElement } {
  const pane = document.createElement("div");
  const page = document.createElement("div");
  page.setAttribute("data-panel-new-tab-page", "");
  const input = document.createElement("input");
  input.setAttribute("role", "combobox");
  page.append(input);
  pane.append(page);
  document.body.append(pane);
  return { pane, input };
}

function press(
  input: HTMLInputElement,
  value: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  input.value = value;
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  input.dispatchEvent(event);
  return event;
}

async function mount(): Promise<void> {
  mounted = await mountPluginContentScripts(app, { pluginId: "new-tab-url" });
}

describe("new tab URL", () => {
  it("opens a pasted link on Enter and keeps bb from searching files", async () => {
    const opened: string[] = [];
    const { pane, input } = addPane();
    const slot = renderOpener((url) => (opened.push(url), true));
    pane.append(slot.container);
    await mount();

    const event = press(input, "github.com/anthropics");

    expect(opened).toEqual(["https://github.com/anthropics"]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves file queries and modified Enter to bb", async () => {
    const opened: string[] = [];
    const { pane, input } = addPane();
    pane.append(renderOpener((url) => (opened.push(url), true)).container);
    await mount();

    expect(press(input, "app.tsx").defaultPrevented).toBe(false);
    expect(
      press(input, "https://example.com", { metaKey: true }).defaultPrevented,
    ).toBe(false);
    expect(
      press(input, "https://example.com", { isComposing: true })
        .defaultPrevented,
    ).toBe(false);
    expect(opened).toEqual([]);
  });

  it("falls through when the host declines the link", async () => {
    const { pane, input } = addPane();
    pane.append(renderOpener(() => false).container);
    await mount();

    expect(press(input, "https://example.com").defaultPrevented).toBe(false);
  });

  it("ignores inputs outside the new-tab page", async () => {
    const opened: string[] = [];
    const { pane } = addPane();
    pane.append(renderOpener((url) => (opened.push(url), true)).container);
    const other = document.createElement("input");
    other.setAttribute("role", "combobox");
    document.body.append(other);
    await mount();

    expect(press(other, "https://example.com").defaultPrevented).toBe(false);
    expect(opened).toEqual([]);
  });

  it("routes the link through the pane that owns the input", async () => {
    const first: string[] = [];
    const second: string[] = [];
    const a = addPane();
    const b = addPane();
    a.pane.append(renderOpener((url) => (first.push(url), true)).container);
    b.pane.append(renderOpener((url) => (second.push(url), true)).container);
    await mount();

    press(b.input, "https://example.com");
    press(a.input, "https://example.org");

    expect(second).toEqual(["https://example.com/"]);
    expect(first).toEqual(["https://example.org/"]);
  });

  it("stops intercepting once disposed", async () => {
    const opened: string[] = [];
    const { pane, input } = addPane();
    pane.append(renderOpener((url) => (opened.push(url), true)).container);
    await mount();
    await mounted?.lifecycle.dispose();
    mounted = null;

    expect(press(input, "https://example.com").defaultPrevented).toBe(false);
    expect(opened).toEqual([]);
  });
});
