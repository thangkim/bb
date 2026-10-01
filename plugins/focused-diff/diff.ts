import type { JsonValue, PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";

export type FocusedDiffResult =
  | { kind: "patch"; patch: string; truncated: boolean }
  | { kind: "unchanged" }
  | { kind: "unavailable"; message: string };

type BrowserSdk = PluginBrowserBbSdk;
type EnvironmentBranches = Pick<
  Awaited<ReturnType<BrowserSdk["environments"]["get"]>>,
  "mergeBaseBranch" | "baseBranch" | "defaultBranch"
>;

export interface FocusedDiffSdk {
  threads: {
    get(args: {
      threadId: string;
      signal: AbortSignal;
    }): Promise<{ environmentId: string | null }>;
  };
  environments: {
    get(args: {
      environmentId: string;
      signal: AbortSignal;
    }): Promise<EnvironmentBranches>;
    diffPatch(
      args: Parameters<BrowserSdk["environments"]["diffPatch"]>[0],
    ): ReturnType<BrowserSdk["environments"]["diffPatch"]>;
  };
}

export interface PatchStats {
  insertions: number;
  deletions: number;
}

export function parseFocusedDiffParams(params: JsonValue | null): string | null {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  const path = params.path;
  return typeof path === "string" && path.trim() !== "" ? path : null;
}

export function countPatchLines(patch: string): PatchStats {
  let insertions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) insertions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { insertions, deletions };
}

export async function loadFocusedDiff(
  sdk: FocusedDiffSdk,
  threadId: string,
  path: string,
  signal: AbortSignal,
): Promise<FocusedDiffResult> {
  const thread = await sdk.threads.get({ threadId, signal });
  if (thread.environmentId === null) {
    return { kind: "unavailable", message: "This thread has no workspace." };
  }
  const environment = await sdk.environments.get({
    environmentId: thread.environmentId,
    signal,
  });
  const mergeBaseBranch =
    environment.mergeBaseBranch ??
    environment.baseBranch ??
    environment.defaultBranch;
  const response = await sdk.environments.diffPatch({
    environmentId: thread.environmentId,
    paths: [path],
    target: mergeBaseBranch
      ? { type: "all", mergeBaseBranch }
      : { type: "uncommitted" },
    signal,
  });
  if (response.outcome === "not_applicable") {
    return { kind: "unavailable", message: response.message };
  }
  if (response.outcome === "unavailable") {
    return {
      kind: "unavailable",
      message: "The workspace for this thread is unavailable right now.",
    };
  }
  const entry = response.patches.find((patch) => patch.path === path);
  if (entry === undefined || entry.patch.trim() === "") {
    return { kind: "unchanged" };
  }
  return { kind: "patch", patch: entry.patch, truncated: entry.truncated };
}
