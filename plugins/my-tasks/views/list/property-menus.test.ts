// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PRIORITIES } from "../../shared/contract.js";
import {
  isBareKey,
  PRIORITY_MENU_ORDER,
  priorityForShortcut,
} from "./property-menus.js";

describe("PRIORITY_MENU_ORDER", () => {
  it("lists No priority first (0) and covers every priority once", () => {
    expect(PRIORITY_MENU_ORDER[0]).toBe("none");
    expect([...PRIORITY_MENU_ORDER].sort()).toEqual([...PRIORITIES].sort());
  });
});

describe("priorityForShortcut", () => {
  it("maps 0-based digits to the picker order", () => {
    expect(priorityForShortcut("0")).toBe("none");
    expect(priorityForShortcut("1")).toBe("urgent");
    expect(priorityForShortcut("4")).toBe("low");
  });

  it("rejects out-of-range and non-digit keys", () => {
    expect(priorityForShortcut("5")).toBeNull();
    expect(priorityForShortcut("p")).toBeNull();
  });
});

describe("isBareKey", () => {
  const base = {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  };
  it("is true only with no modifier held", () => {
    expect(isBareKey(base)).toBe(true);
    expect(isBareKey({ ...base, metaKey: true })).toBe(false);
    expect(isBareKey({ ...base, ctrlKey: true })).toBe(false);
    expect(isBareKey({ ...base, altKey: true })).toBe(false);
    expect(isBareKey({ ...base, shiftKey: true })).toBe(false);
  });
});
