import { describe, expect, it } from "vitest";
import {
  countPatchLines,
  loadFocusedDiff,
  parseFocusedDiffParams,
  sameFocusedDiff,
  type FocusedDiffSdk,
} from "./diff.js";

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,2 @@",
  "-old",
  "+new",
  "+added",
  " same",
  "",
].join("\n");

type DiffPatchResult = Awaited<
  ReturnType<FocusedDiffSdk["environments"]["diffPatch"]>
>;

function fakeSdk(options: {
  environmentId?: string | null;
  branches?: {
    mergeBaseBranch: string | null;
    baseBranch: string | null;
    defaultBranch: string | null;
  };
  result?: DiffPatchResult;
}) {
  const diffPatchCalls: unknown[] = [];
  const sdk: FocusedDiffSdk = {
    threads: {
      get: async () => ({
        environmentId:
          options.environmentId === undefined ? "env-1" : options.environmentId,
      }),
    },
    environments: {
      get: async () =>
        options.branches ?? {
          mergeBaseBranch: null,
          baseBranch: null,
          defaultBranch: null,
        },
      diffPatch: async ({ signal: _signal, ...input }) => {
        diffPatchCalls.push(input);
        return options.result ?? { outcome: "available", patches: [] };
      },
    },
  };
  return { sdk, diffPatchCalls };
}

const signal = new AbortController().signal;

describe("loadFocusedDiff", () => {
  it("requests only the clicked file against the first configured branch", async () => {
    const { sdk, diffPatchCalls } = fakeSdk({
      branches: { mergeBaseBranch: null, baseBranch: "develop", defaultBranch: "main" },
      result: {
        outcome: "available",
        patches: [
          { path: "src/other.ts", patch: "+x", truncated: false },
          { path: "src/a.ts", patch: PATCH, truncated: true },
        ],
      },
    });

    await expect(loadFocusedDiff(sdk, "thread-1", "src/a.ts", signal)).resolves.toEqual({
      kind: "patch",
      patch: PATCH,
      truncated: true,
    });
    expect(diffPatchCalls).toEqual([
      {
        environmentId: "env-1",
        paths: ["src/a.ts"],
        target: { type: "all", mergeBaseBranch: "develop" },
      },
    ]);
  });

  it("falls back to uncommitted changes and reports a file without a patch", async () => {
    const { sdk, diffPatchCalls } = fakeSdk({});
    await expect(loadFocusedDiff(sdk, "thread-1", "src/a.ts", signal)).resolves.toEqual({
      kind: "unchanged",
    });
    expect(diffPatchCalls).toEqual([
      expect.objectContaining({ target: { type: "uncommitted" } }),
    ]);
  });

  it("explains threads without a workspace and non-git environments", async () => {
    await expect(
      loadFocusedDiff(fakeSdk({ environmentId: null }).sdk, "thread-1", "a.ts", signal),
    ).resolves.toEqual({
      kind: "unavailable",
      message: "This thread has no workspace.",
    });
    const nonGit = fakeSdk({
      result: {
        outcome: "not_applicable",
        reason: "non_git_environment",
        message: "This environment is not a git repository.",
      },
    });
    await expect(loadFocusedDiff(nonGit.sdk, "thread-1", "a.ts", signal)).resolves.toEqual({
      kind: "unavailable",
      message: "This environment is not a git repository.",
    });
  });
});

describe("sameFocusedDiff", () => {
  it("treats a re-polled identical result as unchanged and any difference as new", () => {
    const patch = { kind: "patch", patch: "+a", truncated: false } as const;
    expect(sameFocusedDiff(patch, { ...patch })).toBe(true);
    expect(sameFocusedDiff(patch, { ...patch, patch: "+b" })).toBe(false);
    expect(sameFocusedDiff(patch, { ...patch, truncated: true })).toBe(false);
    expect(sameFocusedDiff(patch, { kind: "unchanged" })).toBe(false);
    expect(
      sameFocusedDiff(
        { kind: "unavailable", message: "x" },
        { kind: "unavailable", message: "y" },
      ),
    ).toBe(false);
  });
});

describe("countPatchLines", () => {
  it("counts changed lines without the file headers", () => {
    expect(countPatchLines(PATCH)).toEqual({ insertions: 2, deletions: 1 });
  });
});

describe("parseFocusedDiffParams", () => {
  it("accepts only an object with a non-empty path", () => {
    expect(parseFocusedDiffParams({ path: "src/a.ts" })).toBe("src/a.ts");
    expect(parseFocusedDiffParams(null)).toBeNull();
    expect(parseFocusedDiffParams({ path: " " })).toBeNull();
    expect(parseFocusedDiffParams(["src/a.ts"])).toBeNull();
    expect(parseFocusedDiffParams({ path: 3 })).toBeNull();
  });
});
