// @vitest-environment jsdom
import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  PANE_WIDTH_STORAGE_KEY,
  parsePaneWidth,
  pinnedRowGrows,
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

describe("pinnedRowGrows", () => {
  it("fills the row when the remembered width is under half of it", () => {
    const grows = pinnedRowGrows(400, {
      rootWidth: 1201,
      fixedWidth: 1,
      siblings: [{ nthChild: 3, grow: 0.5 }],
    });
    expect(grows!.self).toBeCloseTo(1 / 3);
    expect(grows!.siblings).toEqual([
      { nthChild: 3, grow: expect.closeTo(2 / 3) },
    ]);
  });

  it("splits the rest between the other panes in their current proportions", () => {
    const grows = pinnedRowGrows(600, {
      rootWidth: 1200,
      fixedWidth: 0,
      siblings: [
        { nthChild: 3, grow: 0.5 },
        { nthChild: 5, grow: 0.25 },
      ],
    });
    expect(grows!.self).toBeCloseTo(0.5);
    expect(grows!.siblings.map((sibling) => sibling.grow)).toEqual([
      expect.closeTo(1 / 3),
      expect.closeTo(1 / 6),
    ]);
  });

  it("leaves room for the other panes and gives up when nothing else grows", () => {
    const grows = pinnedRowGrows(2000, {
      rootWidth: 1000,
      fixedWidth: 0,
      siblings: [{ nthChild: 3, grow: 1 }],
    });
    expect(grows!.self).toBeCloseTo(0.76);
    expect(
      pinnedRowGrows(400, { rootWidth: 1000, fixedWidth: 0, siblings: [] }),
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
    const separator =
      document.querySelector<HTMLElement>('[role="separator"]')!;
    render(<Probe layoutKey={0} />);

    await act(async () => {
      separator.dataset.dragging = "true";
      await Promise.resolve();
      cell.style.flexGrow = "0.3";
      await Promise.resolve();
    });
    expect(
      document.getElementById("bb-tomato-pane-width")?.textContent,
    ).toContain("flex-grow: 0.375000");
    expect(cell.hasAttribute("data-tomato-pane-width")).toBe(true);

    await act(async () => {
      delete separator.dataset.dragging;
      await Promise.resolve();
    });
    expect(window.localStorage.getItem(PANE_WIDTH_STORAGE_KEY)).toBe("355");
  });

  it("pins every visible pane in the row to the remembered width", () => {
    mountSplit(`
      <div data-split-resize-grid-root="" id="outer">
        <div id="tasks-cell" style="flex-grow: 0.333">
          <div data-split-pane-id="pane-1"><div id="slot"></div></div>
        </div>
        ${divider("vertical")}
        <div style="flex-grow: 0.333"><div data-split-pane-id="pane-2"></div></div>
        ${divider("vertical")}
        <div style="flex-grow: 0.333; display: none"><div data-split-pane-id="pane-3"></div></div>
      </div>`);
    document.getElementById("outer")!.getBoundingClientRect = () =>
      ({ width: 1200 }) as DOMRect;
    window.localStorage.setItem(PANE_WIDTH_STORAGE_KEY, "400");
    render(<Probe layoutKey={0} />);

    const css = document.getElementById("bb-tomato-pane-width")!.textContent;
    expect(css).toContain("[data-tomato-pane-width] { flex-grow: 0.333333");
    expect(css).toContain(":nth-child(3) { flex-grow: 0.666667");
    expect(css).not.toContain(":nth-child(5)");
    expect(
      document.getElementById("outer")!.hasAttribute("data-tomato-pane-row"),
    ).toBe(true);
  });

  it("does nothing until a width has been chosen, and unpins on unmount", () => {
    rowSplit();
    const cell = document.getElementById("tasks-cell")!;
    const view = render(<Probe layoutKey={0} />);
    expect(cell.hasAttribute("data-tomato-pane-width")).toBe(false);
    view.unmount();
    expect(cell.hasAttribute("data-tomato-pane-width")).toBe(false);
    expect(
      document.getElementById("outer")!.hasAttribute("data-tomato-pane-row"),
    ).toBe(false);
  });
});
