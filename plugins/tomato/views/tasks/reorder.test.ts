import { describe, expect, it } from "vitest";
import { positionBetween, reorderNeighbors } from "./reorder.js";

const items = ["a", "b", "c", "d"].map((id, index) => ({
  id,
  position: (index + 1) * 1024,
}));

function ids(neighbors: ReturnType<typeof reorderNeighbors>) {
  return neighbors && [neighbors.before?.id, neighbors.after?.id];
}

describe("reorderNeighbors", () => {
  it("returns the neighbors around the drop slot, skipping the dragged item", () => {
    expect(ids(reorderNeighbors(items, "d", "b", "before"))).toEqual([
      "a",
      "b",
    ]);
    expect(ids(reorderNeighbors(items, "a", "c", "after"))).toEqual([
      "c",
      "d",
    ]);
    expect(ids(reorderNeighbors(items, "c", "a", "before"))).toEqual([
      undefined,
      "a",
    ]);
    expect(ids(reorderNeighbors(items, "a", "d", "after"))).toEqual([
      "d",
      undefined,
    ]);
  });

  it("treats drops that keep the current slot as no-ops", () => {
    expect(reorderNeighbors(items, "b", "b", "before")).toBeNull();
    expect(reorderNeighbors(items, "b", "a", "after")).toBeNull();
    expect(reorderNeighbors(items, "b", "c", "before")).toBeNull();
    expect(reorderNeighbors(items, "z", "a", "before")).toBeNull();
  });
});

describe("positionBetween", () => {
  it("places between, before the first, or after the last item", () => {
    expect(positionBetween(items[0], items[1])).toBe(1536);
    expect(positionBetween(undefined, items[0])).toBe(0);
    expect(positionBetween(items[3], undefined)).toBe(5120);
  });
});
