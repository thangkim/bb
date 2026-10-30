import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  defineRpcContract,
  type BbPluginApi,
  type PluginRpcHandlers,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { candidatePaths, pickHit, type Hit } from "./resolve.js";

const SEARCH_ROOTS_TTL_MS = 30_000;
const MAX_DIRS_PER_LEVEL = 200;

const openerSourceSchema = z
  .object({
    kind: z.enum(["workspace", "host", "thread-storage"]),
    threadId: z.string().nullable(),
    environmentId: z.string().nullable(),
    projectId: z.string().nullable(),
    experimental_hostId: z.string().min(1).optional(),
  })
  .strict();

export const fileLinkRpcContract = defineRpcContract({
  resolveFile: {
    input: z
      .object({ source: openerSourceSchema, path: z.string().min(1) })
      .strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("workspace") }).strict(),
      z
        .object({
          status: z.literal("found"),
          absolutePath: z.string(),
          content: z.string(),
          others: z.array(z.string()),
        })
        .strict(),
      z
        .object({ status: z.literal("missing"), tried: z.array(z.string()) })
        .strict(),
    ]),
  },
});

async function childDirectories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          entry.name !== "node_modules",
      )
      .slice(0, MAX_DIRS_PER_LEVEL)
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

async function buildSearchRoots(home: string): Promise<string[]> {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const containers = [
    ...(uid === null ? [] : [`/tmp/claude-${uid}`]),
    path.join(home, ".claude", "plugins", "marketplaces"),
  ];
  const roots = [home, path.join(home, ".claude"), path.join(home, ".claude", "skills")];
  for (const container of containers) {
    const level1 = await childDirectories(container);
    roots.push(...level1);
    for (const dir of level1) roots.push(...(await childDirectories(dir)));
  }
  return roots;
}

async function modifiedAtMsOfFile(absolutePath: string): Promise<number | null> {
  try {
    const info = await stat(absolutePath);
    return info.isFile() ? info.mtimeMs : null;
  } catch {
    return null;
  }
}

export default async function plugin(bb: BbPluginApi) {
  const home = os.homedir();
  let cachedRoots: { at: number; roots: string[] } | null = null;

  async function searchRoots(): Promise<string[]> {
    const now = Date.now();
    if (cachedRoots !== null && now - cachedRoots.at < SEARCH_ROOTS_TTL_MS) {
      return cachedRoots.roots;
    }
    const roots = await buildSearchRoots(home);
    cachedRoots = { at: now, roots };
    return roots;
  }

  const handlers: PluginRpcHandlers<typeof fileLinkRpcContract> = {
    async resolveFile(input) {
      const { source } = input;
      if (source.kind !== "workspace" || source.environmentId === null) {
        return { status: "workspace" };
      }
      const environment = await bb.sdk.environments.get({
        environmentId: source.environmentId,
      });
      if (!environment.path) return { status: "workspace" };
      const primaryHostId = (await bb.sdk.system.config()).primaryHostId;
      if (environment.hostId !== primaryHostId) return { status: "workspace" };

      const candidates = candidatePaths({
        path: input.path,
        workspaceRoot: environment.path,
        home,
        searchRoots: await searchRoots(),
      });
      const hits: Hit[] = [];
      for (const candidate of candidates) {
        const modifiedAtMs = await modifiedAtMsOfFile(candidate.absolutePath);
        if (modifiedAtMs !== null) hits.push({ ...candidate, modifiedAtMs });
      }
      const picked = pickHit(hits);
      if (picked === null) {
        return {
          status: "missing",
          tried: candidates.map((candidate) => candidate.absolutePath),
        };
      }
      if (picked.chosen.inWorkspace) return { status: "workspace" };

      const file = await bb.sdk.files.read({
        path: picked.chosen.absolutePath,
        rootPath: path.dirname(picked.chosen.absolutePath),
        ...(environment.hostId ? { hostId: environment.hostId } : {}),
      });
      if (file.contentEncoding !== "utf8") {
        throw new Error("This file is not UTF-8 text");
      }
      return {
        status: "found",
        absolutePath: picked.chosen.absolutePath,
        content: file.content,
        others: picked.others,
      };
    },
  };

  bb.rpc.register(fileLinkRpcContract, handlers);
}
