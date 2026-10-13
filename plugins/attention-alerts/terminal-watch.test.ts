import { describe, expect, it } from "vitest";
import {
  createTerminalScanner,
  createTerminalWatcher,
  terminalName,
  type TerminalFinished,
} from "./terminal-watch.js";

function session(overrides: { id?: string; threadId?: string | null } = {}) {
  return {
    id: overrides.id ?? "terminal-1",
    threadId:
      overrides.threadId === undefined ? "thread-1" : overrides.threadId,
    environmentId: null,
    hostId: "host-1",
    title: "Terminal 1",
    initialCwd: "/repo",
    cols: 80,
    rows: 24,
    status: "running" as const,
    exitCode: null,
    closeReason: null,
    createdAt: 1,
    updatedAt: 1,
    lastUserInputAt: 1,
  };
}

describe("terminal scanner", () => {
  it("finds bells outside OSC sequences and titles split across chunks", () => {
    const scanner = createTerminalScanner();
    expect(scanner.scan("\u001b]0;⠂ Fix the bu")).toEqual({
      bell: false,
      notification: null,
      title: null,
    });
    expect(scanner.scan("g\u0007done\u0007")).toEqual({
      bell: true,
      notification: null,
      title: "⠂ Fix the bug",
    });
  });

  it("reads OSC 9 and OSC 777 notifications but ignores OSC 9 progress", () => {
    const scanner = createTerminalScanner();
    expect(scanner.scan("\u001b]9;4;1;50\u0007").notification).toBeNull();
    expect(
      scanner.scan("\u001b]9;Claude is waiting\u001b\\").notification,
    ).toBe("Claude is waiting");
    expect(
      scanner.scan("\u001b]777;notify;Claude Code;Task done\u0007")
        .notification,
    ).toBe("Task done");
  });

  it("names the terminal from its OSC title without spinner glyphs", () => {
    expect(terminalName("✳ Fix the bug", "Terminal 1")).toBe("Fix the bug");
    expect(terminalName("⠐ ", "Terminal 1")).toBe("Terminal 1");
    expect(terminalName(null, "Terminal 1")).toBe("Terminal 1");
  });
});

function setupWatcher() {
  let clock = 0;
  const outputs: string[] = [];
  let running = true;
  const finished: TerminalFinished[] = [];
  let seq = 0;
  const watcher = createTerminalWatcher({
    async readOutput() {
      seq += 1;
      return { text: outputs.shift() ?? "", nextSeq: seq, running };
    },
    onFinished: (item) => {
      finished.push(item);
    },
    now: () => clock,
    minBusyMs: 5_000,
    quietMs: 4_000,
    bellGraceMs: 1_500,
    maxWatchMs: 60_000,
  });
  const tick = () =>
    watcher.tick((error) => {
      throw error;
    });
  return {
    watcher,
    finished,
    outputs,
    tick,
    advance(ms: number) {
      clock += ms;
    },
    exit() {
      running = false;
    },
  };
}

describe("terminal watcher", () => {
  it("reports a terminal that went quiet after working for a while", async () => {
    const t = setupWatcher();
    t.watcher.onInput(session());
    await t.tick();
    t.advance(6_000);
    t.outputs.push("\u001b]0;✳ Fix the bug\u0007⠂ Thinking");
    await t.tick();
    t.advance(3_000);
    await t.tick();
    expect(t.finished).toEqual([]);
    t.advance(1_000);
    await t.tick();
    expect(t.finished).toMatchObject([{ name: "Fix the bug", message: null }]);
    expect(t.watcher.watching()).toBe(0);
  });

  it("names the terminal from a title set before the first read", async () => {
    const t = setupWatcher();
    t.outputs.push("\u001b]0;✳ Early title\u0007");
    t.watcher.onInput(session());
    await t.tick();
    t.advance(6_000);
    t.outputs.push("tick");
    await t.tick();
    t.advance(4_000);
    await t.tick();
    expect(t.finished).toMatchObject([{ name: "Early title" }]);
  });

  it("drops short commands without reporting them", async () => {
    const t = setupWatcher();
    t.watcher.onInput(session());
    await t.tick();
    t.advance(500);
    t.outputs.push("file.txt\n$ ");
    await t.tick();
    t.advance(5_000);
    await t.tick();
    expect(t.finished).toEqual([]);
    expect(t.watcher.watching()).toBe(0);
  });

  it("measures busy time from the latest input", async () => {
    const t = setupWatcher();
    t.watcher.onInput(session());
    await t.tick();
    t.advance(6_000);
    t.outputs.push("echo");
    t.watcher.onInput(session());
    await t.tick();
    t.advance(4_000);
    await t.tick();
    expect(t.finished).toEqual([]);
  });

  it("reports a notification escape at once, but not a bell right after typing", async () => {
    const t = setupWatcher();
    t.watcher.onInput(session());
    await t.tick();
    t.advance(200);
    t.outputs.push("\u0007");
    await t.tick();
    expect(t.finished).toEqual([]);
    t.advance(2_000);
    t.outputs.push("\u001b]9;Claude needs your permission\u0007");
    await t.tick();
    expect(t.finished).toMatchObject([
      { message: "Claude needs your permission" },
    ]);
  });

  it("ignores terminals outside threads and stops watching exited ones", async () => {
    const t = setupWatcher();
    t.watcher.onInput(session({ threadId: null }));
    expect(t.watcher.watching()).toBe(0);
    t.watcher.onInput(session());
    t.exit();
    await t.tick();
    expect(t.watcher.watching()).toBe(0);
    expect(t.finished).toEqual([]);
  });
});
