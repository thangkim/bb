import { describe, expect, it } from "vitest";
import type { Label } from "../../shared/contract.js";
import {
  formatDueDate,
  groupProjectsByStatus,
  partitionLabels,
  progressPercent,
} from "./lib.js";
import { makeProject } from "../../test-fixtures.js";

const ULID_A = "01ARZ3NDEKTSV4RRFFQ69G5FAA";
const ULID_B = "01ARZ3NDEKTSV4RRFFQ69G5FAB";
const ULID_C = "01ARZ3NDEKTSV4RRFFQ69G5FAC";

describe("groupProjectsByStatus", () => {
  it("orders groups by workflow and hides empty ones", () => {
    const groups = groupProjectsByStatus([
      makeProject({ id: ULID_A, status: "done" }),
      makeProject({ id: ULID_B, status: "in_progress" }),
      makeProject({ id: ULID_C, status: "in_progress" }),
    ]);
    expect(groups.map((group) => group.status)).toEqual([
      "in_progress",
      "done",
    ]);
    expect(groups[0]?.projects.map((project) => project.id)).toEqual([
      ULID_B,
      ULID_C,
    ]);
  });

  it("returns nothing for no projects", () => {
    expect(groupProjectsByStatus([])).toEqual([]);
  });
});

describe("progressPercent", () => {
  it("rounds done over total and treats an empty project as 0%", () => {
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(3, 3)).toBe(100);
    expect(progressPercent(0, 0)).toBe(0);
  });
});

describe("formatDueDate", () => {
  it("omits the current year and shows other years", () => {
    const today = new Date("2026-07-15T12:00:00");
    expect(formatDueDate("2026-07-18", today)).toBe("Jul 18");
    expect(formatDueDate("2027-01-02", today)).toBe("Jan 2, 2027");
  });
});

describe("partitionLabels", () => {
  const label = (name: string): Label => ({
    id: name,
    projectId: ULID_A,
    name,
    color: "#5e6ad2",
  });

  it("keeps everything visible at or under the cap", () => {
    const labels = [label("a"), label("b")];
    expect(partitionLabels(labels, 2)).toEqual({
      visible: labels,
      hidden: [],
    });
    expect(partitionLabels([], 2)).toEqual({ visible: [], hidden: [] });
  });

  it("moves the tail into hidden above the cap", () => {
    const labels = [label("a"), label("b"), label("c")];
    expect(partitionLabels(labels, 1)).toEqual({
      visible: [labels[0]],
      hidden: [labels[1], labels[2]],
    });
  });
});
