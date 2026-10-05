import { describe, expect, it } from "vitest";
import { applyBriefChanges, BriefError, formatBrief, readBrief } from "./brief";

const BRIEF = [
  "Intro the user wrote.",
  "",
  "## Problem statement",
  "",
  "Users cannot connect an existing repo.",
  "",
  "## Notes",
  "",
  "Keep this untouched.",
  "",
  "## Decisions",
  "",
  "- Use SSH keys only",
  "- Support GitLab later",
  "  once GitHub ships",
  "- Ship behind a flag",
].join("\n");

describe("project brief", () => {
  it("reads known sections by alias and joins wrapped decisions", () => {
    expect(readBrief(BRIEF)).toEqual({
      sections: {
        problem: "Users cannot connect an existing repo.",
        context: null,
        priority: null,
        solution: null,
      },
      decisions: [
        "Use SSH keys only",
        "Support GitLab later once GitHub ships",
        "Ship behind a flag",
      ],
    });
  });

  it("rewrites, inserts in order, and removes sections while keeping other text", () => {
    const { description, changes } = applyBriefChanges(BRIEF, {
      sections: {
        problem: "Existing repos fail to import.",
        solution: "Clone over HTTPS with a token.",
        context: "Customers asked in Q3.",
      },
    });
    expect(changes).toEqual([
      "Updated Problem",
      "Updated Context",
      "Updated Solution",
    ]);
    expect(description).toBe(
      [
        "Intro the user wrote.",
        "## Problem statement\n\nExisting repos fail to import.",
        "## Context\n\nCustomers asked in Q3.",
        "## Solution\n\nClone over HTTPS with a token.",
        "## Notes\n\nKeep this untouched.",
        "## Decisions\n\n- Use SSH keys only\n- Support GitLab later\n  once GitHub ships\n- Ship behind a flag",
      ].join("\n\n"),
    );
    const removed = applyBriefChanges(description, {
      sections: { context: null, priority: "" },
    });
    expect(removed.changes).toEqual(["Removed Context"]);
    expect(removed.description).not.toContain("## Context");
  });

  it("deletes, rewords, and adds decisions by text, fragment, or number", () => {
    const { description, changes } = applyBriefChanges(BRIEF, {
      removeDecisions: ["gitlab"],
      replaceDecisions: [{ match: "1", text: "Use SSH keys or tokens" }],
      addDecisions: ["Log every import", "ship behind a flag"],
    });
    expect(changes).toEqual([
      "Changed decision: Use SSH keys or tokens",
      "Removed decision: Support GitLab later once GitHub ships",
      "Added decision: Log every import",
    ]);
    expect(readBrief(description).decisions).toEqual([
      "Use SSH keys or tokens",
      "Ship behind a flag",
      "Log every import",
    ]);
  });

  it("drops the Decisions heading when the last decision is deleted", () => {
    const { description } = applyBriefChanges("## Decisions\n\n- Only one", {
      removeDecisions: ["Only one"],
    });
    expect(description).toBe("");
  });

  it("rejects ambiguous or unknown decision matches without changing anything", () => {
    expect(() =>
      applyBriefChanges(BRIEF, { removeDecisions: ["s"] }),
    ).toThrow(BriefError);
    expect(() =>
      applyBriefChanges(BRIEF, { removeDecisions: ["nothing like it"] }),
    ).toThrow(/no decision matches/);
  });

  it("ignores headings inside code fences", () => {
    const description = "## Solution\n\n```md\n## Problem\n```";
    expect(readBrief(description).sections).toMatchObject({
      problem: null,
      solution: "```md\n## Problem\n```",
    });
  });

  it("formats every section with numbered decisions for agents", () => {
    expect(formatBrief("## Decisions\n\n- A\n- B")).toBe(
      "## Problem\n\n(empty)\n\n## Context\n\n(empty)\n\n## Priority\n\n(empty)\n\n## Solution\n\n(empty)\n\n## Decisions\n\n1. A\n2. B",
    );
  });
});
