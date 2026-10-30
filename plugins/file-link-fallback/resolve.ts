import path from "node:path";

export interface CandidateInput {
  path: string;
  workspaceRoot: string;
  home: string;
  searchRoots: readonly string[];
}

export interface Candidate {
  absolutePath: string;
  inWorkspace: boolean;
}

export function candidatePaths(input: CandidateInput): Candidate[] {
  const raw = input.path.trim();
  if (raw === "") return [];
  if (raw === "~" || raw.startsWith("~/")) {
    return [
      {
        absolutePath: path.posix.join(input.home, raw.slice(1)),
        inWorkspace: false,
      },
    ];
  }
  if (path.posix.isAbsolute(raw)) {
    return [{ absolutePath: path.posix.normalize(raw), inWorkspace: false }];
  }
  const relative = raw.replace(/^(\.\/)+/u, "");
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const roots = [
    { root: input.workspaceRoot, inWorkspace: true },
    ...input.searchRoots.map((root) => ({ root, inWorkspace: false })),
  ];
  for (const { root, inWorkspace } of roots) {
    const absolutePath = path.posix.join(root, relative);
    if (seen.has(absolutePath)) continue;
    seen.add(absolutePath);
    candidates.push({ absolutePath, inWorkspace });
  }
  return candidates;
}

export interface Hit {
  absolutePath: string;
  inWorkspace: boolean;
  modifiedAtMs: number;
}

export function pickHit(hits: readonly Hit[]): {
  chosen: Hit;
  others: string[];
} | null {
  const workspaceHit = hits.find((hit) => hit.inWorkspace);
  const sorted = [...hits].sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
  const chosen = workspaceHit ?? sorted[0];
  if (chosen === undefined) return null;
  return {
    chosen,
    others: sorted
      .filter((hit) => hit.absolutePath !== chosen.absolutePath)
      .map((hit) => hit.absolutePath),
  };
}
