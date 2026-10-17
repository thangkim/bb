import { describe, expect, it } from "vitest";
import type { Task } from "./contract.js";
import { sortItems } from "./sort.js";
import { makeTask } from "../test-fixtures.js";

const ULIDS = [
  "01ARZ3NDEKTSV4RRFFQ69G5FAA",
  "01ARZ3NDEKTSV4RRFFQ69G5FAB",
  "01ARZ3NDEKTSV4RRFFQ69G5FAC",
  "01ARZ3NDEKTSV4RRFFQ69G5FAD",
] as const;

function task(
  key: string,
  overrides: Partial<Pick<Task, "priority" | "dueDate" | "position">> = {},
): Task {
  return makeTask({
    id: ULIDS[Number(key.split("-")[1]) - 1]!,
    position: Number(key.split("-")[1]),
    projectId: ULIDS[0],
    key,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  });
}

const keys = (tasks: readonly Task[]) => tasks.map((t) => t.key);

describe("sortItems", () => {
  it("orders manual by position without mutating the input", () => {
    const input = [task("T-2"), task("T-1"), task("T-3", { position: 0.5 })];
    const sorted = sortItems(input, "manual");
    expect(keys(sorted)).toEqual(["T-3", "T-1", "T-2"]);
    expect(keys(input)).toEqual(["T-2", "T-1", "T-3"]);
  });

  it("orders priority urgent → none with due date breaking ties", () => {
    const sorted = sortItems(
      [
        task("T-1", { priority: "none" }),
        task("T-2", { priority: "high", dueDate: "2026-08-01" }),
        task("T-3", { priority: "high", dueDate: "2026-07-20" }),
        task("T-4", { priority: "urgent" }),
      ],
      "priority",
    );
    expect(keys(sorted)).toEqual(["T-4", "T-3", "T-2", "T-1"]);
  });

  it("orders due dates soonest first, undated last, priority breaking ties", () => {
    const sorted = sortItems(
      [
        task("T-1", { dueDate: null, priority: "urgent" }),
        task("T-2", { dueDate: "2026-07-20", priority: "low" }),
        task("T-3", { dueDate: "2026-07-20", priority: "high" }),
        task("T-4", { dueDate: "2026-07-18" }),
      ],
      "due",
    );
    expect(keys(sorted)).toEqual(["T-4", "T-3", "T-2", "T-1"]);
  });

  it("falls back to manual position when priority and due date tie", () => {
    const input = [
      task("T-3", { priority: "high" }),
      task("T-1", { priority: "high" }),
      task("T-2", { priority: "high" }),
    ];
    expect(keys(sortItems(input, "priority"))).toEqual(["T-1", "T-2", "T-3"]);
    expect(keys(sortItems(input, "due"))).toEqual(["T-1", "T-2", "T-3"]);
  });
});
