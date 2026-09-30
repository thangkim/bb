import { describe, expect, it } from "vitest";
import { makeProject } from "../../test-fixtures.js";
import {
  positionBetween,
  reconcileProjectOverrides,
} from "./use-project-edits.js";

const A = makeProject({ id: "01HZZZZZZZZZZZZZZZZZZZZZPA", position: 1024 });
const B = makeProject({ id: "01HZZZZZZZZZZZZZZZZZZZZZPB", position: 2048 });

describe("positionBetween", () => {
  it("mirrors the server's midpoint placement", () => {
    expect(positionBetween(A, B, 0)).toBe(1536);
    expect(positionBetween(A, undefined, 0)).toBe(2048);
    expect(positionBetween(undefined, A, 0)).toBe(512);
    expect(positionBetween(undefined, undefined, 99)).toBe(99);
  });
});

describe("reconcileProjectOverrides", () => {
  it("drops an override once the server reports the same values", () => {
    const overrides = new Map([
      [A.id, { patch: { status: "done" as const }, gen: 1 }],
      [B.id, { patch: { priority: "high" as const }, gen: 2 }],
    ]);
    const next = reconcileProjectOverrides(overrides, [
      { ...A, status: "done" },
      B,
    ]);
    expect([...next.keys()]).toEqual([B.id]);
  });

  it("drops overrides for projects that no longer exist", () => {
    const overrides = new Map([
      [A.id, { patch: { status: "done" as const }, gen: 1 }],
    ]);
    expect(reconcileProjectOverrides(overrides, [B]).size).toBe(0);
  });

  it("returns the same map when nothing settled", () => {
    const overrides = new Map([
      [A.id, { patch: { status: "done" as const }, gen: 1 }],
    ]);
    expect(reconcileProjectOverrides(overrides, [A])).toBe(overrides);
  });
});
