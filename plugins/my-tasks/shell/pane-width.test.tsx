// @vitest-environment jsdom
import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  PANE_WIDTH_STORAGE_KEY,
  parsePaneWidth,
  pinnedFlexGrow,
  rowCellOf,
  usePersistentPaneWidth,
} from "./pane-width";

function divider(orientation: "vertical" | "horizontal"): string {
  return `<div role="separator" data-split-resize-grid-boundary="1" aria-orientation="${orientation}"><div data-split-divider-hit-target=""></div></div>`;
}

function mountSplit(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

function rowSplit(): HTMLElement {
  return mountSplit(`
    <div data-split-resize-grid-root="" id="outer">
      <div id="tasks-cell" style="flex-grow: 0.5">
        <div data-split-pane-id="pane-1"><div id="slot"></div></div>
      </div>
      ${divider("vertical")}
      <div id="thread-cell" style="flex-grow: 0.5">
        <div data-split-pane-id="pane-2"></div>
      </div>
    </div>`);
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  window.localStorage.clear();
});

describe("parsePaneWidth", () => {
  it("accepts remembered widths at or above the minimum", () => {
    expect(parsePaneWidth("355.4")).toBe(355);
    expect(parsePaneWidth("100")).toBeNull();
    expect(parsePaneWidth("wide")).toBeNull();
    expect(parsePaneWidth(null)).toBeNull();
  });
});

describe("pinnedFlexGrow", () => {
  it("gives the pane the remembered width out of the row's free space", () => {
    const grow = pinnedFlexGrow(400, {
      rootWidth: 1201,
      fixedWidth: 1,
      otherGrow: 0.5,
    });
    expect((1200 * grow!) / (grow! + 0.5)).toBeCloseTo(400);
  });

  it("leaves room for the other panes and gives up when nothing else grows", () => {
    const grow = pinnedFlexGrow(2000, {
      rootWidth: 1000,
      fixedWidth: 0,
      otherGrow: 1,
    });
    expect((1000 * grow!) / (grow! + 1)).toBeCloseTo(760);
    expect(
      pinnedFlexGrow(400, { rootWidth: 1000, fixedWidth: 0, otherGrow: 0 }),
    ).toBeNull();
  });
});

describe("rowCellOf", () => {
  it("finds the pane's cell in the nearest side-by-side split", () => {
    rowSplit();
    expect(rowCellOf(document.getElementById("slot")!)?.id).toBe("tasks-cell");
  });

  it("climbs out of a stacked split to the side-by-side one around it", () => {
    mountSplit(`
      <div data-split-resize-grid-root="">
        <div id="column-cell" style="flex: 1 1 0">
          <div data-split-resize-grid-root="">
            <div style="flex: 1 1 0"><div data-split-pane-id="pane-1"><div id="slot"></div></div></div>
            ${divider("horizontal")}
            <div style="flex: 1 1 0"><div data-split-pane-id="pane-3"></div></div>
          </div>
        </div>
        ${divider("vertical")}
        <div style="flex: 1 1 0"><div data-split-pane-id="pane-2"></div></div>
      </div>`);
    expect(rowCellOf(document.getElementById("slot")!)?.id).toBe("column-cell");
  });

  it("ignores a lone pane and grids that are not bb's split dividers", () => {
    mountSplit(`
      <div data-split-resize-grid-root="">
        <div><div data-split-pane-id="pane-1"><div id="slot"></div></div></div>
        <div data-split-resize-grid-boundary="1" aria-orientation="vertical"></div>
        <div></div>
      </div>`);
    expect(rowCellOf(document.getElementById("slot")!)).toBeNull();
  });
});

function Probe({ layoutKey }: { layoutKey: number }) {
  const ref = useRef<HTMLElement | null>(document.getElementById("slot"));
  usePersistentPaneWidth(ref, layoutKey);
  return null;
}

describe("usePersistentPaneWidth", () => {
  it("remembers the width the user drags the pane to", async () => {
    rowSplit();
    const cell = document.getElementById("tasks-cell")!;
    cell.getBoundingClientRect = () => ({ width: 355 }) as DOMRect;
    const separator = document.querySelector<HTMLElement>('[role="separator"]')!;
    render(<Probe layoutKey={0} />);

    await act(async () => {
      separator.dataset.dragging = "true";
      await Promise.resolve();
      cell.style.flexGrow = "0.3";
      await Promise.resolve();
    });
    expect(document.getElementById("bb-my-tasks-pane-width")?.textContent).toContain(
      "flex-grow: 0.300000",
    );
    expect(cell.hasAttribute("data-my-tasks-pane-width")).toBe(true);

    await act(async () => {
      delete separator.dataset.dragging;
      await Promise.resolve();
    });
    expect(window.localStorage.getItem(PANE_WIDTH_STORAGE_KEY)).toBe("355");
  });

  it("does nothing until a width has been chosen, and unpins on unmount", () => {
    rowSplit();
    const cell = document.getElementById("tasks-cell")!;
    const view = render(<Probe layoutKey={0} />);
    expect(cell.hasAttribute("data-my-tasks-pane-width")).toBe(false);
    view.unmount();
    expect(cell.hasAttribute("data-my-tasks-pane-width")).toBe(false);
  });
});
