import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import {
  sideChatTitleHostContract,
  type GenerateTitleResult,
} from "./title.js";

export const TITLE_TIMEOUT_MS = 60_000;

const TITLE_MODEL = "haiku";

const OUTPUT_TAIL_CHARS = 400;

export interface TitleHostDependencies {
  findClaude(): Promise<string | null>;
  run(
    command: string,
    args: readonly string[],
    stdin: string,
    signal: AbortSignal,
  ): Promise<{ code: number | null; stdout: string; stderr: string }>;
}

export const CLAUDE_TITLE_ARGS = [
  "-p",
  "--model",
  TITLE_MODEL,
  "--no-session-persistence",
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--setting-sources",
  "",
  "--tools",
  "",
] as const;

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findClaudeOnPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): Promise<string | null> {
  const candidates = [
    ...(env.PATH ?? "").split(path.delimiter).filter((dir) => dir !== ""),
    path.join(home, ".local", "bin"),
    path.join(home, ".claude", "local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].map((dir) => path.join(dir, "claude"));
  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > OUTPUT_TAIL_CHARS
    ? trimmed.slice(trimmed.length - OUTPUT_TAIL_CHARS)
    : trimmed;
}

const nodeDependencies: TitleHostDependencies = {
  findClaude: () => findClaudeOnPath(),
  run(command, args, stdin, signal) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        cwd: tmpdir(),
        signal,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(stdin);
    });
  },
};

export async function generateTitle(
  prompt: string,
  signal: AbortSignal,
  dependencies: TitleHostDependencies,
): Promise<GenerateTitleResult> {
  const claude = await dependencies.findClaude();
  if (claude === null) {
    return { ok: false, message: "The claude CLI is not installed" };
  }
  const timeout = AbortSignal.timeout(TITLE_TIMEOUT_MS);
  try {
    const result = await dependencies.run(
      claude,
      CLAUDE_TITLE_ARGS,
      prompt,
      AbortSignal.any([signal, timeout]),
    );
    if (result.code !== 0) {
      return {
        ok: false,
        message: `claude exited with ${result.code}: ${tail(result.stderr || result.stdout)}`,
      };
    }
    return { ok: true, text: result.stdout };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createSideChatTitleHostEntry(
  dependencies: TitleHostDependencies,
) {
  return experimental_defineHostEntry({
    contract: sideChatTitleHostContract,
    handlers: {
      generateTitle: (input, context) =>
        generateTitle(input.prompt, context.signal, dependencies),
    },
  });
}

export default createSideChatTitleHostEntry(nodeDependencies);
