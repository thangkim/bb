import { describe, expect, it } from "vitest";
import { candidatePaths, pickHit } from "./resolve.js";

const base = {
  workspaceRoot: "/work/repo",
  home: "/Users/me",
  searchRoots: ["/tmp/claude-501/internal-skills", "/Users/me/.claude"],
};

describe("candidatePaths", () => {
  it("expands a leading tilde to the home directory", () => {
    expect(
      candidatePaths({ ...base, path: "~/.claude/skills/a/SKILL.md" }),
    ).toEqual([
      {
        absolutePath: "/Users/me/.claude/skills/a/SKILL.md",
        inWorkspace: false,
      },
    ]);
  });

  it("keeps an absolute path as the only candidate", () => {
    expect(candidatePaths({ ...base, path: "/etc/../opt/x.md" })).toEqual([
      { absolutePath: "/opt/x.md", inWorkspace: false },
    ]);
  });

  it("tries the workspace first, then each search root, for a relative path", () => {
    expect(
      candidatePaths({ ...base, path: "./references/guide.md" }).map(
        (candidate) => candidate.absolutePath,
      ),
    ).toEqual([
      "/work/repo/references/guide.md",
      "/tmp/claude-501/internal-skills/references/guide.md",
      "/Users/me/.claude/references/guide.md",
    ]);
  });

  it("marks only the workspace candidate as in the workspace", () => {
    const flags = candidatePaths({ ...base, path: "a.md" }).map(
      (candidate) => candidate.inWorkspace,
    );
    expect(flags).toEqual([true, false, false]);
  });

  it("drops a duplicate root and ignores blank input", () => {
    expect(
      candidatePaths({
        ...base,
        searchRoots: ["/work/repo"],
        path: "a.md",
      }),
    ).toHaveLength(1);
    expect(candidatePaths({ ...base, path: "  " })).toEqual([]);
  });
});

describe("pickHit", () => {
  it("prefers a workspace hit even when another is newer", () => {
    const picked = pickHit([
      { absolutePath: "/other/a.md", inWorkspace: false, modifiedAtMs: 9 },
      { absolutePath: "/work/repo/a.md", inWorkspace: true, modifiedAtMs: 1 },
    ]);
    expect(picked?.chosen.absolutePath).toBe("/work/repo/a.md");
    expect(picked?.others).toEqual(["/other/a.md"]);
  });

  it("picks the most recently modified outside hit and lists the rest newest first", () => {
    const picked = pickHit([
      { absolutePath: "/a.md", inWorkspace: false, modifiedAtMs: 1 },
      { absolutePath: "/b.md", inWorkspace: false, modifiedAtMs: 3 },
      { absolutePath: "/c.md", inWorkspace: false, modifiedAtMs: 2 },
    ]);
    expect(picked?.chosen.absolutePath).toBe("/b.md");
    expect(picked?.others).toEqual(["/c.md", "/a.md"]);
  });

  it("returns null when nothing matched", () => {
    expect(pickHit([])).toBeNull();
  });
});
