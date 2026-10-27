import { describe, expect, it } from "vitest";
import { BASE_BAR_HEIGHT, BASE_BAR_INSET, chromeInsets } from "./chrome-insets";

function rect(left: number, top: number, right: number, bottom: number) {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  } as DOMRect;
}

describe("chromeInsets", () => {
  const bar = rect(50, 0, 1000, 36);

  it("clears window controls that overlap the bar on the left", () => {
    const controls = rect(84, 8, 170, 32);
    expect(chromeInsets(bar, [controls])).toEqual({
      left: 170 + 8 - 50,
      right: BASE_BAR_INSET,
      height: 40,
    });
  });

  it("clears a right-side toggle that overlaps the bar", () => {
    const toggle = rect(960, 8, 990, 32);
    expect(chromeInsets(bar, [toggle])).toEqual({
      left: BASE_BAR_INSET,
      right: 1000 - 960 + 8,
      height: 40,
    });
  });

  it("ignores controls the bar does not share a row with", () => {
    const controls = rect(84, 8, 170, 32);
    expect(chromeInsets(rect(300, 40, 1000, 76), [controls])).toEqual({
      left: BASE_BAR_INSET,
      right: BASE_BAR_INSET,
      height: BASE_BAR_HEIGHT,
    });
  });

  it("grows the bar so its center lines up with the controls", () => {
    expect(chromeInsets(bar, [rect(84, 14, 170, 38)]).height).toBe(52);
    expect(chromeInsets(bar, [rect(84, 4, 170, 28)]).height).toBe(
      BASE_BAR_HEIGHT,
    );
  });

  it("keeps the base inset when the bar starts right of the controls", () => {
    const controls = rect(84, 8, 170, 32);
    expect(chromeInsets(rect(300, 0, 1000, 36), [controls]).left).toBe(
      BASE_BAR_INSET,
    );
  });

  it("ignores empty obstacles", () => {
    expect(chromeInsets(bar, [rect(0, 0, 0, 0)])).toEqual({
      left: BASE_BAR_INSET,
      right: BASE_BAR_INSET,
      height: BASE_BAR_HEIGHT,
    });
  });
});
