// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  loadPluginApp,
  mountPluginContentScripts,
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
  defineTemporaryProperty(navigator, "clipboard", { write: clipboardWrite });
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
});

afterEach(async () => {
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
