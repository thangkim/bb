// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineWindowedItemsLoader } from "./TimelineWindowedItemsLoader.js";
import { TIMELINE_RENDER_ALL_ATTRIBUTE } from "./timeline-render-all.js";

const ITEM_KEYS = Array.from({ length: 100 }, (_, index) => `row-${index}`);

let scrollElement: HTMLDivElement;

function rect(top: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 320,
    top,
    width: 320,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

class ResizeObserverStub implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  disconnect(): void {}
  observe(): void {
    queueMicrotask(() => this.callback([], this));
  }
  unobserve(): void {}
}

function defineGeometry(element: HTMLElement, name: string, value: number) {
  Object.defineProperty(element, name, { configurable: true, value });
}

function renderLoader(measurements: Map<string, number>) {
  return render(
    <TimelineWindowedItemsLoader
      estimateItemHeight={() => 32}
      gap={0}
      getScrollElement={() => scrollElement}
      itemKeys={ITEM_KEYS}
      measurements={measurements}
      renderItem={(index, state) => (
        <div
          key={ITEM_KEYS[index]}
          ref={state.itemRef}
          data-index={state.itemIndex}
          data-testid={`row-${index}`}
          data-timeline-windowed-realized={String(state.isRealized)}
          style={state.itemStyle}
        />
      )}
    />,
    { container: scrollElement },
  );
}

beforeEach(() => {
  scrollElement = document.createElement("div");
  document.body.append(scrollElement);
  defineGeometry(scrollElement, "clientWidth", 320);
  defineGeometry(scrollElement, "offsetWidth", 320);
  defineGeometry(scrollElement, "clientHeight", 96);
  defineGeometry(scrollElement, "offsetHeight", 96);
  defineGeometry(scrollElement, "scrollHeight", 3_200);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this === scrollElement) return rect(0, 96);
      const index = Number(this.dataset.index);
      if (Number.isInteger(index)) {
        return rect(index * 32 - scrollElement.scrollTop, 32);
      }
      return rect(0, Number.parseFloat(this.style.height) || 0);
    },
  );
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute(TIMELINE_RENDER_ALL_ATTRIBUTE);
  scrollElement.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useTimelineRenderAllRequested", () => {
  it("mounts every row while the document requests it and windows again after", async () => {
    const measurements = new Map<string, number>();
    renderLoader(measurements);
    await waitFor(() => expect(screen.getByTestId("row-0")).toBeTruthy());
    expect(screen.queryByTestId("row-99")).toBeNull();

    await act(async () => {
      document.documentElement.setAttribute(TIMELINE_RENDER_ALL_ATTRIBUTE, "");
    });
    await waitFor(() =>
      expect(screen.getAllByTestId(/^row-/)).toHaveLength(100),
    );
    expect(measurements.get("row-99")).toBe(32);

    await act(async () => {
      document.documentElement.removeAttribute(TIMELINE_RENDER_ALL_ATTRIBUTE);
    });
    await waitFor(() => expect(screen.queryByTestId("row-99")).toBeNull());
    expect(screen.getByTestId("row-0")).toBeTruthy();
  });

  it("mounts every row when the request predates the mount", async () => {
    document.documentElement.setAttribute(TIMELINE_RENDER_ALL_ATTRIBUTE, "");

    renderLoader(new Map());

    await waitFor(() =>
      expect(screen.getAllByTestId(/^row-/)).toHaveLength(100),
    );
  });
});
