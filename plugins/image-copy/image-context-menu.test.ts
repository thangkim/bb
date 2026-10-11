// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  IMAGE_CONTEXT_MENU_VIEWPORT_MARGIN_PX,
  placeImageContextMenu,
  resolveImageContextTarget,
} from "./image-context-menu";

afterEach(() => {
  document.body.replaceChildren();
});

function loadedImage(src = "/api/v1/images/cat.png"): HTMLImageElement {
  const image = document.createElement("img");
  image.src = src;
  Object.defineProperty(image, "complete", { configurable: true, value: true });
  Object.defineProperty(image, "naturalWidth", {
    configurable: true,
    value: 640,
  });
  return image;
}

function contextMenu(
  target: EventTarget,
  init: MouseEventInit & { pointerType?: string } = {},
): MouseEvent {
  const { pointerType, ...mouseInit } = init;
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 60,
    ...mouseInit,
  });
  if (pointerType !== undefined) {
    Object.defineProperty(event, "pointerType", { value: pointerType });
  }
  Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("resolveImageContextTarget", () => {
  it("describes a loaded image with its link and the current selection", () => {
    const link = document.createElement("a");
    link.href = "https://example.com/full.png";
    const image = loadedImage();
    link.append(image);
    document.body.append(link);

    expect(resolveImageContextTarget(contextMenu(image), "caption")).toEqual({
      imageUrl: new URL("/api/v1/images/cat.png", window.location.href).href,
      linkUrl: "https://example.com/full.png",
      selectionText: "caption",
      x: 40,
      y: 60,
    });
  });

  it("reports no link for an unlinked image", () => {
    const image = loadedImage();
    document.body.append(image);

    expect(resolveImageContextTarget(contextMenu(image), "")?.linkUrl).toBe(
      null,
    );
  });

  it.each([
    ["a menu already claimed by bb", { claimed: true }],
    ["Shift held for the native menu", { shiftKey: true }],
    ["a touch long-press", { pointerType: "touch" }],
    ["a pen long-press", { pointerType: "pen" }],
  ])("leaves %s alone", (_name, options) => {
    const image = loadedImage();
    document.body.append(image);
    const { claimed, ...init } = { claimed: false, ...options };
    const event = contextMenu(image, init);
    if (claimed) event.preventDefault();

    expect(resolveImageContextTarget(event, "")).toBe(null);
  });

  it("ignores images that have not loaded", () => {
    const image = loadedImage();
    Object.defineProperty(image, "naturalWidth", { value: 0 });
    document.body.append(image);

    expect(resolveImageContextTarget(contextMenu(image), "")).toBe(null);
  });

  it("ignores images inside editable content", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const image = loadedImage();
    editor.append(image);
    document.body.append(editor);

    expect(resolveImageContextTarget(contextMenu(image), "")).toBe(null);
  });

  it("ignores targets that are not images", () => {
    const paragraph = document.createElement("p");
    document.body.append(paragraph);

    expect(resolveImageContextTarget(contextMenu(paragraph), "")).toBe(null);
  });
});

describe("placeImageContextMenu", () => {
  const viewport = { width: 800, height: 600 };
  const menu = { width: 160, height: 90 };
  const margin = IMAGE_CONTEXT_MENU_VIEWPORT_MARGIN_PX;

  it("opens at the pointer when the menu fits", () => {
    expect(placeImageContextMenu({ x: 100, y: 120 }, menu, viewport)).toEqual({
      left: 100,
      top: 120,
    });
  });

  it("opens up and to the left near the bottom-right corner", () => {
    expect(placeImageContextMenu({ x: 790, y: 590 }, menu, viewport)).toEqual({
      left: 630,
      top: 500,
    });
  });

  it("keeps a menu inside the viewport margin when it fits neither way", () => {
    expect(
      placeImageContextMenu(
        { x: 100, y: 50 },
        { width: 160, height: 200 },
        { width: 800, height: 220 },
      ),
    ).toEqual({ left: 100, top: margin });
  });
});
