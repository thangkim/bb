// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bridgedPair,
  installBridgedDividerDrag,
  pairFraction,
} from "./bridged-divider";

interface Row {
  root: HTMLElement;
  cells: HTMLElement[];
  dividers: HTMLElement[];
}

function rect(left: number, width: number): DOMRect {
  return {
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 100,
    height: 100,
    x: left,
    y: 0,
    toJSON: () => ({}),
  };
}

function buildRow(widths: readonly number[], hidden: readonly number[]): Row {
  const root = document.createElement("div");
  root.setAttribute("data-split-resize-grid-root", "");
  const cells: HTMLElement[] = [];
  const dividers: HTMLElement[] = [];
  let left = 0;
  widths.forEach((width, index) => {
    if (index > 0) {
      const divider = document.createElement("div");
      divider.setAttribute("data-split-resize-grid-boundary", String(index));
      divider.setAttribute("aria-orientation", "vertical");
      const hitTarget = document.createElement("div");
      hitTarget.setAttribute("data-split-divider-hit-target", "");
      divider.append(hitTarget);
      const dividerLeft = left;
      divider.getBoundingClientRect = () => rect(dividerLeft, 1);
      root.append(divider);
      dividers.push(divider);
      left += 1;
    }
    const cell = document.createElement("div");
    cell.style.flex = "0.25 1 0px";
    if (hidden.includes(index)) cell.style.display = "none";
    const cellLeft = left;
    cell.getBoundingClientRect = () => rect(cellLeft, width);
    root.append(cell);
    cells.push(cell);
    left += width;
  });
  document.body.append(root);
  return { root, cells, dividers };
}

function pointer(type: string, clientX: number): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

function hitTargetOf(divider: HTMLElement): HTMLElement {
  const hitTarget = divider.firstElementChild;
  if (!(hitTarget instanceof HTMLElement)) throw new Error("no hit target");
  return hitTarget;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("bridgedPair", () => {
  it("leaves dividers between two visible neighbours to core", () => {
    const { dividers } = buildRow([400, 400], []);
    expect(bridgedPair(dividers[0]!)).toBeNull();
  });

  it("pairs the nearest visible cells across a minimized pane", () => {
    const { cells, dividers } = buildRow([400, 0, 400, 0], [1, 3]);
    expect(bridgedPair(dividers[0]!)).toEqual({
      previous: cells[0],
      next: cells[2],
    });
  });

  it("steps over the minimized-thread rail so the divider before it still resizes the cells around it", () => {
    const { root, cells, dividers } = buildRow([400, 400], []);
    const rail = document.createElement("div");
    rail.setAttribute("data-pane-collapse-rail", "");
    root.insertBefore(rail, cells[1]!);
    expect(bridgedPair(dividers[0]!)).toEqual({
      previous: cells[0],
      next: cells[1],
    });
  });

  it("ignores a divider with no visible cell on one side", () => {
    const { dividers } = buildRow([400, 0], [1]);
    expect(bridgedPair(dividers[0]!)).toBeNull();
  });
});

describe("pairFraction", () => {
  it("clamps like core's split pair limits", () => {
    expect(pairFraction(200.5, 0, 800, 1)).toBe(0.25);
    expect(pairFraction(0, 0, 800, 1)).toBe(0.15);
    expect(pairFraction(10_000, 0, 800, 1)).toBe(0.85);
  });
});

describe("installBridgedDividerDrag", () => {
  it("resizes the visible pair and keeps core from seeing the press", () => {
    const { cells, dividers } = buildRow([400, 0, 400], [1]);
    const coreHandler = vi.fn();
    document.body.addEventListener("pointerdown", coreHandler);
    const uninstall = installBridgedDividerDrag(document);
    const hitTarget = hitTargetOf(dividers[0]!);

    hitTarget.dispatchEvent(pointer("pointerdown", 400));
    expect(coreHandler).not.toHaveBeenCalled();
    expect(dividers[0]!.dataset.dragging).toBe("true");

    hitTarget.dispatchEvent(pointer("pointermove", 200.5));
    expect(cells[0]!.style.flex).toBe("0.125 1 0px");
    expect(cells[2]!.style.flex).toBe("0.375 1 0px");
    expect(cells[1]!.style.flex).toBe("0.25 1 0px");

    hitTarget.dispatchEvent(pointer("pointerup", 200.5));
    expect(dividers[0]!.dataset.dragging).toBeUndefined();
    expect(cells[0]!.style.flex).toBe("0.125 1 0px");

    uninstall();
  });

  it("restores the pair when the drag is cancelled", () => {
    const { cells, dividers } = buildRow([400, 0, 400], [1]);
    const uninstall = installBridgedDividerDrag(document);
    const hitTarget = hitTargetOf(dividers[0]!);

    hitTarget.dispatchEvent(pointer("pointerdown", 400));
    hitTarget.dispatchEvent(pointer("pointermove", 600));
    hitTarget.dispatchEvent(pointer("pointercancel", 600));
    expect(cells[0]!.style.flex).toBe("0.25 1 0px");
    expect(cells[2]!.style.flex).toBe("0.25 1 0px");

    uninstall();
  });

  it("lets core handle dividers between adjacent visible cells", () => {
    const { cells, dividers } = buildRow([400, 400], []);
    const coreHandler = vi.fn();
    document.body.addEventListener("pointerdown", coreHandler);
    const uninstall = installBridgedDividerDrag(document);

    hitTargetOf(dividers[0]!).dispatchEvent(pointer("pointerdown", 400));
    expect(coreHandler).toHaveBeenCalledOnce();
    expect(dividers[0]!.dataset.dragging).toBeUndefined();
    expect(cells[0]!.style.flex).toBe("0.25 1 0px");

    uninstall();
  });
});
