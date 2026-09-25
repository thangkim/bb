// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TIMELINE_RENDER_ALL_ATTRIBUTE } from "./thread-find-dom";
import {
  THREAD_FIND_ACTIVE_HIGHLIGHT,
  THREAD_FIND_MATCH_HIGHLIGHT,
} from "./thread-find-matches";
import { findInThreadCommand } from "./app";
import { openThreadFindForFocus } from "./thread-find-store";

class HighlightStub {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

let highlights: Map<string, HighlightStub>;
let originalRangeRect: Range["getBoundingClientRect"] | undefined;

function mountThread(): { composer: HTMLTextAreaElement } {
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<div id="thread" data-thread-window="">
      <div data-timeline-row-list="top-level">
        <p>Deploy the server</p>
        <p>Restart the SERVER</p>
      </div>
      <div data-scroll-footer=""><textarea id="composer">server</textarea></div>
    </div>
    <div data-app-browser=""><input id="browser" /></div>`,
  );
  const composer = document.getElementById("composer");
  if (!(composer instanceof HTMLTextAreaElement)) throw new Error("composer");
  return { composer };
}

async function flushFrames() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

async function renderOverlay() {
  const app = await loadPluginApp(() => import("./app"));
  const overlay = app.appOverlays[0];
  if (overlay === undefined) throw new Error("overlay not registered");
  return renderSlot(overlay, {});
}

function highlightTexts(name: string): string[] {
  return (highlights.get(name)?.ranges ?? []).map((range) => range.toString());
}

beforeEach(() => {
  highlights = new Map();
  vi.stubGlobal("CSS", { highlights });
  vi.stubGlobal("Highlight", HighlightStub);
  originalRangeRect = Range.prototype.getBoundingClientRect;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  document.documentElement.removeAttribute(TIMELINE_RENDER_ALL_ATTRIBUTE);
  if (originalRangeRect === undefined) {
    Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  } else {
    Range.prototype.getBoundingClientRect = originalRangeRect;
  }
  vi.unstubAllGlobals();
});

describe("thread find overlay", () => {
  it("opens on Mod+F in a thread, highlights matches, and steps through them", async () => {
    const { composer } = mountThread();
    await renderOverlay();
    composer.focus();

    const event = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      composer.dispatchEvent(event);
    });
    await flushFrames();

    expect(event.defaultPrevented).toBe(true);
    const input = screen.getByRole("textbox", { name: "Find in thread" });
    expect(document.activeElement).toBe(input);
    expect(
      document.documentElement.hasAttribute(TIMELINE_RENDER_ALL_ATTRIBUTE),
    ).toBe(true);

    fireEvent.change(input, { target: { value: "server" } });
    await flushFrames();

    expect(screen.getByText("1/2")).toBeTruthy();
    expect(highlightTexts(THREAD_FIND_ACTIVE_HIGHLIGHT)).toEqual(["server"]);
    expect(highlightTexts(THREAD_FIND_MATCH_HIGHLIGHT)).toEqual(["SERVER"]);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("2/2")).toBeTruthy();
    expect(highlightTexts(THREAD_FIND_ACTIVE_HIGHLIGHT)).toEqual(["SERVER"]);

    fireEvent.keyDown(input, { key: "g", ctrlKey: true, shiftKey: true });
    expect(screen.getByText("1/2")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("search")).toBeNull();
    expect(document.activeElement).toBe(composer);
    expect(
      document.documentElement.hasAttribute(TIMELINE_RENDER_ALL_ATTRIBUTE),
    ).toBe(false);
    expect(highlights.size).toBe(0);
  });

  it("reports no results and re-searches when the timeline changes", async () => {
    mountThread();
    await renderOverlay();
    act(() => {
      openThreadFindForFocus(document);
    });
    await flushFrames();
    const input = screen.getByRole("textbox", { name: "Find in thread" });

    fireEvent.change(input, { target: { value: "rollback" } });
    await flushFrames();
    expect(screen.getByText("No results")).toBeTruthy();

    vi.useFakeTimers();
    try {
      act(() => {
        document
          .querySelector('[data-timeline-row-list="top-level"]')
          ?.insertAdjacentHTML("beforeend", "<p>Rollback done</p>");
      });
      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(150);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByText("1/1")).toBeTruthy();
  });

  it("leaves Mod+F alone inside the in-app browser", async () => {
    mountThread();
    await renderOverlay();
    const browserInput = document.getElementById("browser");
    if (browserInput === null) throw new Error("browser input");

    const event = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      browserInput.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("stops forcing every row to render when the overlay unmounts", async () => {
    mountThread();
    const slot = await renderOverlay();
    act(() => {
      openThreadFindForFocus(document);
    });
    expect(
      document.documentElement.hasAttribute(TIMELINE_RENDER_ALL_ATTRIBUTE),
    ).toBe(true);

    slot.lifecycle.unmount();

    expect(
      document.documentElement.hasAttribute(TIMELINE_RENDER_ALL_ATTRIBUTE),
    ).toBe(false);
    expect(highlights.size).toBe(0);
  });

  it("closes when its thread window leaves the document", async () => {
    mountThread();
    await renderOverlay();
    act(() => {
      openThreadFindForFocus(document);
    });
    await flushFrames();
    const input = screen.getByRole("textbox", { name: "Find in thread" });

    act(() => {
      document.getElementById("thread")?.remove();
    });
    fireEvent.change(input, { target: { value: "server" } });
    await flushFrames();

    expect(screen.queryByRole("search")).toBeNull();
  });
});

describe("find command", () => {
  const context = {
    projectId: "project-1",
    openPanel: () => false,
  };

  it("is offered only on a thread", () => {
    expect(
      findInThreadCommand.isAvailable({ ...context, threadId: "thread-1" }),
    ).toBe(true);
    expect(
      findInThreadCommand.isAvailable({ ...context, threadId: null }),
    ).toBe(false);
  });

  it("opens find for the thread that regained focus after the palette", async () => {
    const { composer } = mountThread();
    await renderOverlay();
    composer.focus();

    act(() => {
      findInThreadCommand.run();
    });
    await flushFrames();

    expect(
      screen.getByRole("textbox", { name: "Find in thread" }),
    ).toBeTruthy();
  });
});
