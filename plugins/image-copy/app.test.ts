// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
  type MountedPluginContentScripts,
} from "@get-bb/plugin-sdk/testing/app";
import { convertImageBlobToPng } from "./image-copy";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

class FakeClipboardItem {
  constructor(readonly items: Record<string, Blob | Promise<Blob>>) {}
}

const app = await loadPluginApp(() => import("./app"));
let mounted: MountedPluginContentScripts | null = null;
let clipboardWrite: ReturnType<typeof vi.fn>;
let clipboardWriteText: ReturnType<typeof vi.fn>;
const restorers: Array<() => void> = [];

function defineTemporaryProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  const previous = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, {
    configurable: true,
    writable: true,
    value,
  });
  restorers.push(() => {
    if (previous === undefined) {
      Reflect.deleteProperty(target, key);
    } else {
      Object.defineProperty(target, key, previous);
    }
  });
}

function stubFetch(response: { ok: boolean; status: number; blob: Blob }) {
  const fetchMock = vi.fn(async () => ({
    ok: response.ok,
    status: response.status,
    blob: async () => response.blob,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  clipboardWrite = vi.fn(async (items: FakeClipboardItem[]) => {
    await items[0]!.items["image/png"];
  });
  clipboardWriteText = vi.fn(async () => {});
  defineTemporaryProperty(navigator, "clipboard", {
    write: clipboardWrite,
    writeText: clipboardWriteText,
  });
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
});

afterEach(async () => {
  cleanup();
  await mounted?.lifecycle.dispose();
  mounted = null;
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
  while (restorers.length > 0) restorers.pop()!();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

async function mount(): Promise<MountedPluginContentScripts> {
  mounted = await mountPluginContentScripts(app, { pluginId: "image-copy" });
  return mounted;
}

function openLightbox(src: string | null = "/api/v1/images/cat.png") {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.tabIndex = -1;
  const title = document.createElement("h2");
  title.textContent = "Image preview";
  dialog.append(title);
  if (src !== null) {
    const image = document.createElement("img");
    image.src = src;
    image.alt = "cat";
    dialog.append(image);
  } else {
    const loading = document.createElement("div");
    loading.setAttribute("role", "status");
    dialog.append(loading);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Close image preview");
  const onClose = vi.fn(() => dialog.remove());
  close.addEventListener("click", onClose);
  dialog.append(close);
  document.body.append(dialog);
  dialog.focus();
  return { dialog, onClose };
}

function press(
  init: KeyboardEventInit,
  target: EventTarget = document.activeElement ?? document.body,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "c",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("image lightbox copy", () => {
  it.each([
    ["Meta", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
  ])(
    "copies the image as PNG within the %s+C gesture, then closes",
    async (_name, init) => {
      const png = new Blob(["png"], { type: "image/png" });
      const fetchMock = stubFetch({ ok: true, status: 200, blob: png });
      const { onClose } = openLightbox();
      await mount();

      const event = press(init);

      expect(event.defaultPrevented).toBe(true);
      expect(clipboardWrite).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        new URL("/api/v1/images/cat.png", window.location.href).href,
      );
      const [items] = clipboardWrite.mock.calls[0] as [FakeClipboardItem[]];
      expect(Object.keys(items[0]!.items)).toEqual(["image/png"]);
      await expect(items[0]!.items["image/png"]).resolves.toBe(png);
      await flush();
      expect(toast.success).toHaveBeenCalledWith("Image copied");
      expect(toast.error).not.toHaveBeenCalled();
    },
  );

  it("reports a failed clipboard write and still closes", async () => {
    stubFetch({
      ok: true,
      status: 200,
      blob: new Blob(["png"], { type: "image/png" }),
    });
    clipboardWrite.mockRejectedValueOnce(new Error("denied"));
    const { onClose } = openLightbox();
    await mount();

    press({ metaKey: true });
    await flush();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Failed to copy image");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("reports a failed image request", async () => {
    stubFetch({ ok: false, status: 404, blob: new Blob([]) });
    openLightbox();
    await mount();

    press({ metaKey: true });
    await flush();

    expect(toast.error).toHaveBeenCalledWith("Failed to copy image");
  });

  it("reports failure when the clipboard cannot hold images", async () => {
    stubFetch({
      ok: true,
      status: 200,
      blob: new Blob(["png"], { type: "image/png" }),
    });
    vi.stubGlobal("ClipboardItem", undefined);
    openLightbox();
    await mount();

    press({ metaKey: true });
    await flush();

    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Failed to copy image");
  });

  it("re-encodes a non-PNG image through a canvas", async () => {
    const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
    const encoded = new Blob(["png"], { type: "image/png" });
    stubFetch({ ok: true, status: 200, blob: jpeg });
    const drawImage = vi.fn();
    const createObjectURL = vi.fn(() => "blob:converted");
    const revokeObjectURL = vi.fn();
    defineTemporaryProperty(URL, "createObjectURL", createObjectURL);
    defineTemporaryProperty(URL, "revokeObjectURL", revokeObjectURL);
    defineTemporaryProperty(
      HTMLImageElement.prototype,
      "decode",
      async () => {},
    );
    defineTemporaryProperty(HTMLCanvasElement.prototype, "getContext", () => ({
      drawImage,
    }));
    defineTemporaryProperty(
      HTMLCanvasElement.prototype,
      "toBlob",
      (callback: BlobCallback, type?: string) => {
        expect(type).toBe("image/png");
        callback(encoded);
      },
    );
    openLightbox("/api/v1/images/cat.jpg");
    await mount();

    press({ metaKey: true });
    const [items] = clipboardWrite.mock.calls[0] as [FakeClipboardItem[]];

    await expect(items[0]!.items["image/png"]).resolves.toBe(encoded);
    expect(createObjectURL).toHaveBeenCalledWith(jpeg);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:converted");
    await flush();
    expect(toast.success).toHaveBeenCalledWith("Image copied");
  });

  it("rejects when the canvas cannot encode the image", async () => {
    defineTemporaryProperty(URL, "createObjectURL", () => "blob:converted");
    defineTemporaryProperty(URL, "revokeObjectURL", () => {});
    defineTemporaryProperty(
      HTMLImageElement.prototype,
      "decode",
      async () => {},
    );
    defineTemporaryProperty(
      HTMLCanvasElement.prototype,
      "getContext",
      () => null,
    );

    await expect(
      convertImageBlobToPng(new Blob(["webp"], { type: "image/webp" })),
    ).rejects.toThrow("cannot convert");
  });

  it.each([
    ["no modifier", {}],
    ["Shift", { metaKey: true, shiftKey: true }],
    ["Alt", { metaKey: true, altKey: true }],
    ["repeat", { metaKey: true, repeat: true }],
    ["another key", { metaKey: true, key: "v" }],
  ])("ignores %s", async (_name, init) => {
    stubFetch({ ok: true, status: 200, blob: new Blob([]) });
    const { onClose } = openLightbox();
    await mount();

    const event = press(init);

    expect(event.defaultPrevented).toBe(false);
    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves native copy alone when text is selected", async () => {
    stubFetch({ ok: true, status: 200, blob: new Blob([]) });
    const { dialog, onClose } = openLightbox();
    await mount();
    const range = document.createRange();
    range.selectNodeContents(dialog.querySelector("h2")!);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.isCollapsed).toBe(false);

    const event = press({ metaKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores copy from an editable target", async () => {
    stubFetch({ ok: true, status: 200, blob: new Blob([]) });
    const { onClose } = openLightbox();
    await mount();
    const input = document.createElement("input");
    document.body.append(input);

    const event = press({ metaKey: true }, input);

    expect(event.defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores copy without an open lightbox image", async () => {
    stubFetch({ ok: true, status: 200, blob: new Blob([]) });
    const unrelated = document.createElement("div");
    unrelated.setAttribute("role", "dialog");
    unrelated.append(document.createElement("img"));
    document.body.append(unrelated);
    await mount();

    expect(press({ metaKey: true }).defaultPrevented).toBe(false);

    const { onClose } = openLightbox(null);
    expect(press({ metaKey: true }).defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it("stops handling copy after dispose", async () => {
    stubFetch({ ok: true, status: 200, blob: new Blob([]) });
    const { onClose } = openLightbox();
    const scripts = await mount();

    await scripts.lifecycle.dispose();
    mounted = null;

    expect(scripts.inspection.signal.aborted).toBe(true);
    expect(press({ metaKey: true }).defaultPrevented).toBe(false);
    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

function renderMenuOverlay() {
  const overlay = app.appOverlays[0];
  if (overlay === undefined) throw new Error("overlay not registered");
  return renderSlot(overlay, {});
}

function appendLoadedImage(
  parent: HTMLElement = document.body,
  src = "/api/v1/images/cat.png",
): HTMLImageElement {
  const image = document.createElement("img");
  image.src = src;
  image.alt = "cat";
  Object.defineProperty(image, "complete", { configurable: true, value: true });
  Object.defineProperty(image, "naturalWidth", {
    configurable: true,
    value: 640,
  });
  parent.append(image);
  return image;
}

function openMenuOn(target: Element, init: MouseEventInit = {}): boolean {
  return fireEvent.contextMenu(target, { clientX: 40, clientY: 60, ...init });
}

function menuLabels(): string[] {
  return screen
    .queryAllByRole("menuitem")
    .map((item) => item.textContent ?? "");
}

describe("image context menu", () => {
  it("replaces the native menu on an image and copies it as PNG", async () => {
    const png = new Blob(["png"], { type: "image/png" });
    const fetchMock = stubFetch({ ok: true, status: 200, blob: png });
    renderMenuOverlay();
    const image = appendLoadedImage();

    expect(openMenuOn(image)).toBe(false);
    expect(screen.getByRole("menu", { name: "Image" })).toBeTruthy();
    expect(menuLabels()).toEqual(["Copy Image"]);
    expect(document.activeElement?.textContent).toBe("Copy Image");

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy Image" }));

    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/api/v1/images/cat.png", window.location.href).href,
    );
    const [items] = clipboardWrite.mock.calls[0] as [FakeClipboardItem[]];
    await expect(items[0]!.items["image/png"]).resolves.toBe(png);
    expect(screen.queryByRole("menu")).toBe(null);
    await flush();
    expect(toast.success).toHaveBeenCalledWith("Image copied");
  });

  it("reports a failed copy from the menu", async () => {
    stubFetch({ ok: false, status: 404, blob: new Blob([]) });
    renderMenuOverlay();
    openMenuOn(appendLoadedImage());

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy Image" }));
    await flush();

    expect(toast.error).toHaveBeenCalledWith("Failed to copy image");
  });

  it("keeps Copy Link for a linked image", async () => {
    renderMenuOverlay();
    const link = document.createElement("a");
    link.href = "https://example.com/full.png";
    document.body.append(link);
    openMenuOn(appendLoadedImage(link));

    expect(menuLabels()).toEqual(["Copy Image", "Copy Link"]);
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy Link" }));
    await flush();

    expect(clipboardWriteText).toHaveBeenCalledWith(
      "https://example.com/full.png",
    );
    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBe(null);
  });

  it("keeps Copy for the text selected when the menu opened", async () => {
    renderMenuOverlay();
    const caption = document.createElement("p");
    caption.textContent = "A sleepy cat";
    document.body.append(caption);
    const image = appendLoadedImage();
    const range = document.createRange();
    range.selectNodeContents(caption);
    window.getSelection()!.addRange(range);

    openMenuOn(image);
    window.getSelection()!.removeAllRanges();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    await flush();

    expect(clipboardWriteText).toHaveBeenCalledWith("A sleepy cat");
  });

  it("reports a failed text copy", async () => {
    clipboardWriteText.mockRejectedValueOnce(new Error("denied"));
    renderMenuOverlay();
    const link = document.createElement("a");
    link.href = "https://example.com/full.png";
    document.body.append(link);
    openMenuOn(appendLoadedImage(link));

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy Link" }));
    await flush();

    expect(toast.error).toHaveBeenCalledWith("Failed to copy link");
  });

  it.each([
    ["Shift+right-click", { shiftKey: true }],
    ["a menu bb already handled", { claimed: true }],
  ])("leaves the native menu for %s", (_name, options) => {
    renderMenuOverlay();
    const image = appendLoadedImage();
    const { claimed, ...init } = { claimed: false, ...options };
    if (claimed) {
      image.addEventListener("contextmenu", (event) => event.preventDefault());
    }

    openMenuOn(image, init);

    expect(screen.queryByRole("menu")).toBe(null);
  });

  it("leaves the native menu for an image that has not loaded", () => {
    renderMenuOverlay();
    const image = appendLoadedImage();
    Object.defineProperty(image, "naturalWidth", { value: 0 });

    expect(openMenuOn(image)).toBe(true);
    expect(screen.queryByRole("menu")).toBe(null);
  });

  it("closes on a right-click elsewhere so the native menu shows", () => {
    renderMenuOverlay();
    const paragraph = document.createElement("p");
    document.body.append(paragraph);
    openMenuOn(appendLoadedImage());

    expect(openMenuOn(paragraph)).toBe(true);
    expect(screen.queryByRole("menu")).toBe(null);
  });

  it("moves through items with the arrow keys", () => {
    renderMenuOverlay();
    const link = document.createElement("a");
    link.href = "https://example.com/full.png";
    document.body.append(link);
    openMenuOn(appendLoadedImage(link));
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Copy Link");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Copy Image");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("Copy Link");
  });

  it("closes on Escape without reaching other Escape handlers and restores focus", () => {
    renderMenuOverlay();
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const image = appendLoadedImage();
    const onEscape = vi.fn();
    window.addEventListener("keydown", onEscape);
    restorers.push(() => window.removeEventListener("keydown", onEscape));
    openMenuOn(image);

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    fireEvent(document.activeElement ?? document.body, escape);

    expect(escape.defaultPrevented).toBe(true);
    expect(onEscape).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBe(null);
    expect(document.activeElement).toBe(button);
  });

  it("dismisses on an outside click without clicking through", () => {
    renderMenuOverlay();
    const behind = document.createElement("button");
    const onClick = vi.fn();
    behind.addEventListener("click", onClick);
    document.body.append(behind);
    openMenuOn(appendLoadedImage());

    fireEvent.pointerDown(behind, { button: 0 });
    fireEvent.click(behind);

    expect(screen.queryByRole("menu")).toBe(null);
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.click(behind);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("closes when the page scrolls", () => {
    renderMenuOverlay();
    openMenuOn(appendLoadedImage());

    fireEvent.scroll(document.body);

    expect(screen.queryByRole("menu")).toBe(null);
  });
});
