// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THREAD_FIND_ACTIVE_HIGHLIGHT,
  THREAD_FIND_MATCH_HIGHLIGHT,
} from "./thread-find-matches";
import { findInThreadCommand } from "./app";
import { openThreadFindForFocus } from "./thread-find-store";
import {
  mountVirtualTimeline,
  type VirtualTimeline,
} from "./virtual-timeline.test-helpers";

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

type RenderOverlayOptions = Parameters<typeof renderSlot>[2];

async function renderOverlay(options?: RenderOverlayOptions) {
  const app = await loadPluginApp(() => import("./app"));
  const overlay = app.appOverlays[0];
  if (overlay === undefined) throw new Error("overlay not registered");
  return renderSlot(overlay, {}, options);
}

function conversationRow(id: string, text: string) {
  return { id, kind: "conversation", role: "assistant", text };
}

function timelinePage(
  rows: ReturnType<typeof conversationRow>[],
  olderCursor: { anchorSeq: number; anchorId: string } | null = null,
) {
  return {
    rows,
    timelinePage: { hasOlderRows: olderCursor !== null, olderCursor },
  };
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

  it("clears its highlights when the overlay unmounts", async () => {
    mountThread();
    const slot = await renderOverlay();
    act(() => {
      openThreadFindForFocus(document);
    });
    await flushFrames();
    fireEvent.change(screen.getByRole("textbox", { name: "Find in thread" }), {
      target: { value: "server" },
    });
    await flushFrames();
    expect(highlights.size).toBeGreaterThan(0);

    slot.lifecycle.unmount();

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

describe("thread find across windowed rows", () => {
  let timeline: VirtualTimeline | null = null;

  afterEach(() => {
    timeline?.restore();
    timeline = null;
  });

  function mountWindowedThread() {
    const rows = [
      { id: "m0", html: "<p>first needle</p>" },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `m${index + 1}`,
        html: "<p>filler</p>",
      })),
      { id: "m9", html: "<p>last needle</p>" },
    ];
    timeline = mountVirtualTimeline({ rows });
    return timeline;
  }

  async function openAndSearch(query: string) {
    act(() => {
      openThreadFindForFocus(document);
    });
    await flushFrames();
    fireEvent.change(screen.getByRole("textbox", { name: "Find in thread" }), {
      target: { value: query },
    });
    await flushFrames();
  }

  it("counts matches in rows that are not mounted and scrolls them into view", async () => {
    const { mountedIds, scroller } = mountWindowedThread();
    const timelineCalls: unknown[] = [];
    await renderOverlay({
      context: { threadId: "thread-1" },
      sdk: {
        threads: {
          timeline: async (args) => {
            timelineCalls.push(args);
            if (args.beforeAnchorId === undefined) {
              return timelinePage(
                Array.from({ length: 8 }, (_, index) =>
                  conversationRow(
                    `m${index + 2}`,
                    index === 7 ? "last **needle**" : "filler",
                  ),
                ),
                { anchorSeq: 2, anchorId: "m2" },
              ) as never;
            }
            return timelinePage([
              conversationRow("m0", "first needle"),
              conversationRow("m1", "filler"),
            ]) as never;
          },
        },
      },
    });
    expect(mountedIds()).not.toContain("m0");

    await openAndSearch("needle");

    await waitFor(() => expect(screen.getByText("2/2")).toBeTruthy());
    expect(timelineCalls).toEqual([
      expect.objectContaining({ threadId: "thread-1", segmentLimit: "100" }),
      expect.objectContaining({
        beforeAnchorSeq: "2",
        beforeAnchorId: "m2",
      }),
    ]);
    expect(highlightTexts(THREAD_FIND_ACTIVE_HIGHLIGHT)).toEqual(["needle"]);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Find in thread" }), {
      key: "Enter",
    });

    await waitFor(() => expect(mountedIds()).toContain("m0"));
    await waitFor(() =>
      expect(
        highlights.get(THREAD_FIND_ACTIVE_HIGHLIGHT)?.ranges[0]?.startContainer
          .textContent,
      ).toBe("first needle"),
    );
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(scroller.scrollTop).toBe(0);
  });

  it("searches only mounted rows when the thread data is unavailable", async () => {
    mountWindowedThread();
    await renderOverlay({
      context: { threadId: "thread-1" },
      sdk: {
        threads: {
          timeline: async () => {
            throw new Error("offline");
          },
        },
      },
    });

    await openAndSearch("needle");

    await waitFor(() => expect(screen.getByText("1/1")).toBeTruthy());
  });

  it("ignores thread data whose rows are not in this thread window", async () => {
    mountWindowedThread();
    await renderOverlay({
      context: { threadId: "other-thread" },
      sdk: {
        threads: {
          timeline: async () =>
            timelinePage([
              conversationRow("x1", "needle"),
              conversationRow("x2", "needle"),
            ]) as never,
        },
      },
    });

    await openAndSearch("needle");
    await flushFrames();

    expect(screen.getByText("1/1")).toBeTruthy();
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
