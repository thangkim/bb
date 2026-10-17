import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CLAUDE_TITLE_ARGS,
  findClaudeOnPath,
  generateTitle,
  type TitleHostDependencies,
} from "./host";
import { buildTitlePrompt, firstTitleLine } from "./title";

function dependencies(
  overrides: Partial<TitleHostDependencies> = {},
): TitleHostDependencies {
  return {
    findClaude: async () => "/bin/claude",
    run: async () => ({ code: 0, stdout: "Wording options\n", stderr: "" }),
    ...overrides,
  };
}

describe("side chat title host", () => {
  it("runs claude without tools, MCP servers, or saved sessions and pipes the prompt on stdin", async () => {
    const run = vi.fn(dependencies().run);
    const result = await generateTitle(
      "the prompt",
      new AbortController().signal,
      dependencies({ run }),
    );
    expect(result).toEqual({ ok: true, text: "Wording options\n" });
    expect(run).toHaveBeenCalledWith(
      "/bin/claude",
      CLAUDE_TITLE_ARGS,
      "the prompt",
      expect.any(AbortSignal),
    );
    expect(CLAUDE_TITLE_ARGS).toEqual(
      expect.arrayContaining([
        "-p",
        "--no-session-persistence",
        "--strict-mcp-config",
      ]),
    );
  });

  it("reports a missing CLI, a failed exit, and a spawn error as failures", async () => {
    const signal = new AbortController().signal;
    await expect(
      generateTitle(
        "p",
        signal,
        dependencies({ findClaude: async () => null }),
      ),
    ).resolves.toEqual({
      ok: false,
      message: "The claude CLI is not installed",
    });
    await expect(
      generateTitle(
        "p",
        signal,
        dependencies({
          run: async () => ({ code: 1, stdout: "", stderr: "Not logged in\n" }),
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      message: "claude exited with 1: Not logged in",
    });
    await expect(
      generateTitle(
        "p",
        signal,
        dependencies({
          run: async () => {
            throw new Error("spawn EACCES");
          },
        }),
      ),
    ).resolves.toEqual({ ok: false, message: "spawn EACCES" });
  });

  it("finds claude in ~/.local/bin when the daemon PATH lacks it", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "side-chat-home-"));
    const bin = path.join(home, ".local", "bin");
    await mkdir(bin, { recursive: true });
    const claude = path.join(bin, "claude");
    await writeFile(claude, "#!/bin/sh\n");
    await chmod(claude, 0o755);
    await expect(
      findClaudeOnPath({ PATH: "/nonexistent" }, home),
    ).resolves.toBe(claude);
  });
});

describe("title prompt", () => {
  it("includes the quoted message and question, clipping long pastes", () => {
    const prompt = buildTitlePrompt({
      quote: "Earlier answer",
      question: "x".repeat(5000),
    });
    expect(prompt).toContain("Earlier answer");
    expect(prompt).toContain(`${"x".repeat(2000)}…`);
    expect(prompt).not.toContain("x".repeat(2001));
    expect(buildTitlePrompt({ quote: null, question: "Why?" })).not.toContain(
      "<message>",
    );
  });

  it("takes the first non-empty line and drops a Title: or heading prefix", () => {
    expect(firstTitleLine("\n\n# Wording options\nmore")).toBe(
      "Wording options",
    );
    expect(firstTitleLine("Title: Retry policy")).toBe("Retry policy");
    expect(firstTitleLine("  \n")).toBeNull();
  });
});
