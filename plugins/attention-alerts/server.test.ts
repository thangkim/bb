import type { PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { alertSchema, ringSchema, type Alert, type Ring } from "./contract.js";
import { createAttentionAlertsPlugin } from "./server.js";

type ThreadResponse = PluginThreadEventPayloads["thread.idle"]["thread"];
type PendingInteraction =
  PluginThreadEventPayloads["interaction.pending"]["interaction"];

const BATCH_MS = 5;
const CLAIM_WINDOW_MS = 30;

function pendingQuestion(
  threadId: string,
  id: string,
  prompt = "Which database should I use?",
): PendingInteraction {
  return {
    id,
    threadId,
    status: "pending",
    statusReason: null,
    createdAt: 1,
    expiresAt: null,
    resolvedAt: null,
    turnId: `turn-${threadId}`,
    providerId: "claude-code",
    providerThreadId: `provider-${threadId}`,
    providerRequestId: `request-${id}`,
    origin: {
      kind: "provider",
      providerId: "claude-code",
      providerThreadId: `provider-${threadId}`,
      providerRequestId: `request-${id}`,
    },
    payload: {
      kind: "user_question",
      questions: [
        { id: "q1", prompt, multiSelect: false, allowFreeText: true },
      ],
    },
    resolution: null,
  };
}

function planReview(threadId: string, id: string): PendingInteraction {
  return {
    id,
    threadId,
    status: "pending",
    statusReason: null,
    createdAt: 1,
    expiresAt: null,
    resolvedAt: null,
    turnId: `turn-${threadId}`,
    providerId: "claude-code",
    providerThreadId: `provider-${threadId}`,
    providerRequestId: `request-${id}`,
    payload: {
      kind: "approval",
      subject: {
        kind: "plan",
        itemId: "item-1",
        plan: "1. Do it",
        planFilePath: null,
      },
      reason: null,
      availableDecisions: ["allow_once", "deny"],
    },
    resolution: null,
  };
}

interface SetupOptions {
  settings?: Record<string, string | number | boolean>;
  hostPlays?: boolean;
  tickMs?: number;
}

async function setup(options: SetupOptions = {}) {
  const threads = new Map<string, ThreadResponse>();
  const interactions = new Map<string, PendingInteraction[]>();
  const hostCalls: { method: string; input: unknown; hostId: string }[] = [];
  let clock = 1_000_000;
  let nextId = 1;
  const fake = createFakePluginHost({
    pluginId: "attention-alerts",
    settings: options.settings ?? {},
    sdk: {
      threads: {
        get: async ({ threadId }) => {
          const thread = threads.get(threadId);
          if (!thread) throw new Error("Thread not found");
          return thread;
        },
        interactions: {
          list: async ({ threadId }) => interactions.get(threadId) ?? [],
        },
      },
    },
    experimental_callHostRpc: ({ method, input, hostId }) => {
      hostCalls.push({ method, input, hostId });
      return { played: options.hostPlays ?? true };
    },
  });
  fake.harness.sdk.stub("system.config", () => ({ primaryHostId: "host-1" }));
  await createAttentionAlertsPlugin({
    batchMs: BATCH_MS,
    claimWindowMs: CLAIM_WINDOW_MS,
    tickMs: options.tickMs ?? 60_000,
    createId: () => `id-${nextId++}`,
    now: () => clock,
  })(fake.bb);

  function setThread(overrides: Partial<ThreadResponse> = {}): ThreadResponse {
    const thread = makeThreadResponse({
      id: `thread-${threads.size + 1}`,
      title: "Fix the flaky test",
      ...overrides,
    });
    threads.set(thread.id, thread);
    return thread;
  }

  async function list(): Promise<Alert[]> {
    const result = await fake.harness.behavior.callRpc("alerts.list", {});
    return alertSchema.array().parse(Reflect.get(Object(result), "alerts"));
  }

  function rings(): Ring[] {
    return fake.harness.inspection.realtimeSignals
      .filter((signal) => signal.channel === "alerts.ring")
      .map((signal) => ringSchema.parse(signal.payload));
  }

  async function claim(ringId: string): Promise<boolean> {
    const result = await fake.harness.behavior.callRpc("rings.claim", {
      ringId,
    });
    return Reflect.get(Object(result), "claimed") === true;
  }

  return {
    ...fake,
    advance(ms: number) {
      clock += ms;
    },
    claim,
    hostCalls,
    interactions,
    list,
    rings,
    setThread,
    threads,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("alert lifecycle", () => {
  it("keeps a question open until it is answered", async () => {
    const host = await setup();
    const thread = host.setThread({ status: "active" });
    const question = pendingQuestion(thread.id, "interaction-1");
    host.interactions.set(thread.id, [question]);

    await host.harness.behavior.emitThreadEvent("interaction.pending", {
      thread,
      interaction: question,
    });
    await wait(BATCH_MS * 4);

    expect(await host.list()).toMatchObject([
      {
        kind: "question",
        threadId: thread.id,
        interactionId: "interaction-1",
        title: "Fix the flaky test",
        body: "Which database should I use?",
      },
    ]);
    expect(host.rings()).toMatchObject([{ reason: "new", sound: "attention" }]);

    await host.harness.behavior.emitThreadEvent("experimental_thread.events", {
      thread,
      sequence: 10,
    });
    expect(await host.list()).toHaveLength(1);

    host.interactions.set(thread.id, [
      { ...question, status: "resolved", resolvedAt: 2 },
    ]);
    await host.harness.behavior.emitThreadEvent("experimental_thread.events", {
      thread,
      sequence: 11,
    });
    expect(await host.list()).toEqual([]);
    await host.harness.lifecycle.dispose();
  });

  it("labels plan reviews and stacks several alerts newest first", async () => {
    const host = await setup();
    const first = host.setThread({ status: "active", title: "First" });
    const second = host.setThread({ status: "idle", title: "Second" });
    const plan = planReview(first.id, "interaction-plan");
    host.interactions.set(first.id, [plan]);

    await host.harness.behavior.emitThreadEvent("interaction.pending", {
      thread: first,
      interaction: plan,
    });
    host.advance(1_000);
    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread: second,
      lastAssistantText: "\nAll tests pass now.\nDetails below",
    });
    await wait(BATCH_MS * 4);

    expect(await host.list()).toMatchObject([
      { kind: "done", title: "Second", body: "All tests pass now." },
      { kind: "plan", title: "First" },
    ]);
    expect(host.rings()).toHaveLength(1);
    expect(host.rings()[0]).toMatchObject({ sound: "attention" });
    expect(host.rings()[0]?.alerts).toHaveLength(2);
    await host.harness.lifecycle.dispose();
  });

  it("replaces a thread's finished alert and clears it when the thread runs again", async () => {
    const host = await setup();
    const thread = host.setThread();

    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread,
      lastAssistantText: "First answer",
    });
    await host.harness.behavior.emitThreadEvent("thread.failed", {
      thread: { ...thread, status: "error" },
      error: "Provider crashed",
    });
    expect(await host.list()).toMatchObject([
      { kind: "error", body: "Provider crashed" },
    ]);

    await host.harness.behavior.emitThreadEvent("thread.active", {
      thread: { ...thread, status: "active" },
    });
    expect(await host.list()).toEqual([]);
    await host.harness.lifecycle.dispose();
  });

  it("skips hidden threads and sub-agent completions, but not sub-agent questions", async () => {
    const host = await setup();
    const hidden = host.setThread({ visibility: "hidden" });
    const child = host.setThread({ parentThreadId: "parent", status: "active" });
    const question = pendingQuestion(child.id, "interaction-child");
    host.interactions.set(child.id, [question]);

    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread: hidden,
      lastAssistantText: "done",
    });
    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread: child,
      lastAssistantText: "done",
    });
    await host.harness.behavior.emitThreadEvent("interaction.pending", {
      thread: child,
      interaction: question,
    });

    expect(await host.list()).toMatchObject([
      { kind: "question", threadId: child.id },
    ]);
    await host.harness.lifecycle.dispose();
  });

  it("removes every alert of an archived thread", async () => {
    const host = await setup();
    const thread = host.setThread();
    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread,
      lastAssistantText: "done",
    });
    await host.harness.behavior.emitThreadEvent("thread.archived", {
      thread: { ...thread, archivedAt: 5 },
    });
    expect(await host.list()).toEqual([]);
    await host.harness.lifecycle.dispose();
  });

  it("respects the per-kind switches", async () => {
    const host = await setup({
      settings: { alertOnDone: false, alertOnQuestions: false },
    });
    const thread = host.setThread({ status: "active" });
    await host.harness.behavior.emitThreadEvent("interaction.pending", {
      thread,
      interaction: pendingQuestion(thread.id, "interaction-1"),
    });
    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread,
      lastAssistantText: "done",
    });
    await host.harness.behavior.emitThreadEvent("thread.failed", {
      thread,
      error: null,
    });
    expect(await host.list()).toMatchObject([
      { kind: "error", body: "The thread stopped on an error" },
    ]);
    await host.harness.lifecycle.dispose();
  });

  it("keeps alerts across a plugin reload", async () => {
    const host = await setup();
    const thread = host.setThread();
    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread,
      lastAssistantText: "done",
    });
    const next = await host.harness.lifecycle.reload(
      createAttentionAlertsPlugin({ tickMs: 60_000 }),
    );
    const result = await next.harness.behavior.callRpc("alerts.list", {});
    expect(Reflect.get(Object(result), "alerts")).toMatchObject([
      { kind: "done", threadId: thread.id },
    ]);
    await next.harness.lifecycle.dispose();
  });
});

describe("sound delivery", () => {
  it("lets exactly one window claim a ring and skips the Mac fallback", async () => {
    const host = await setup();
    await host.harness.behavior.callRpc("alerts.test", { kind: "question" });
    await wait(BATCH_MS * 4);
    const [ring] = host.rings();
    if (!ring) throw new Error("Expected a ring");

    expect(await host.claim(ring.ringId)).toBe(true);
    expect(await host.claim(ring.ringId)).toBe(false);
    await wait(CLAIM_WINDOW_MS * 3);
    expect(host.hostCalls).toEqual([]);
    await host.harness.lifecycle.dispose();
  });

  it("plays on the Mac when no window claims the ring", async () => {
    const host = await setup({ settings: { volume: 40 } });
    await host.harness.behavior.callRpc("alerts.test", { kind: "error" });
    await wait(BATCH_MS * 4 + CLAIM_WINDOW_MS * 3);

    expect(host.hostCalls).toEqual([
      {
        method: "playSound",
        input: { sound: "error", volume: 0.4 },
        hostId: "host-1",
      },
    ]);
    const [ring] = host.rings();
    expect(await host.claim(ring?.ringId ?? "")).toBe(false);
    await host.harness.lifecycle.dispose();
  });

  it("does not fall back when the alert was already dismissed or the fallback is off", async () => {
    const dismissed = await setup();
    const result = await dismissed.harness.behavior.callRpc("alerts.test", {
      kind: "done",
    });
    await dismissed.harness.behavior.callRpc("alerts.dismiss", {
      id: Reflect.get(Object(result), "id"),
    });
    await wait(BATCH_MS * 4 + CLAIM_WINDOW_MS * 3);
    expect(dismissed.rings()).toEqual([]);
    expect(dismissed.hostCalls).toEqual([]);
    await dismissed.harness.lifecycle.dispose();

    const off = await setup({ settings: { macFallback: false } });
    await off.harness.behavior.callRpc("alerts.test", { kind: "done" });
    await wait(BATCH_MS * 4 + CLAIM_WINDOW_MS * 3);
    expect(off.rings()).toHaveLength(1);
    expect(off.hostCalls).toEqual([]);
    await off.harness.lifecycle.dispose();
  });
});

describe("reminders", () => {
  it("repeats waiting questions on the chosen interval, not finished tasks", async () => {
    const host = await setup({
      settings: { repeat: "Every 2 minutes", macFallback: false },
      tickMs: 5,
    });
    const service = host.harness.behavior.runService("reminders");
    await host.harness.behavior.callRpc("alerts.test", { kind: "question" });
    await host.harness.behavior.callRpc("alerts.test", { kind: "done" });
    await wait(BATCH_MS * 4);
    expect(host.rings()).toHaveLength(1);

    host.advance(119_000);
    await wait(30);
    expect(host.rings()).toHaveLength(1);

    host.advance(2_000);
    await wait(30);
    expect(host.rings()).toHaveLength(2);
    expect(host.rings()[1]).toMatchObject({
      reason: "reminder",
      sound: "attention",
      alerts: [{ kind: "question" }],
    });

    host.advance(60_000);
    await wait(30);
    expect(host.rings()).toHaveLength(2);

    service.controller.abort();
    await service.done;
    await host.harness.lifecycle.dispose();
  });

  it("repeats every alert kind when asked, and never when repeat is off", async () => {
    const all = await setup({
      settings: {
        repeat: "Every minute",
        repeatAllKinds: true,
        macFallback: false,
      },
      tickMs: 5,
    });
    const service = all.harness.behavior.runService("reminders");
    await all.harness.behavior.callRpc("alerts.test", { kind: "done" });
    await wait(BATCH_MS * 4);
    all.advance(61_000);
    await wait(30);
    expect(all.rings().map((ring) => ring.reason)).toEqual(["new", "reminder"]);
    service.controller.abort();
    await service.done;
    await all.harness.lifecycle.dispose();

    const off = await setup({
      settings: { repeat: "Off", macFallback: false },
      tickMs: 5,
    });
    const offService = off.harness.behavior.runService("reminders");
    await off.harness.behavior.callRpc("alerts.test", { kind: "question" });
    await wait(BATCH_MS * 4);
    off.advance(3_600_000);
    await wait(30);
    expect(off.rings()).toHaveLength(1);
    offService.controller.abort();
    await offService.done;
    await off.harness.lifecycle.dispose();
  });
});

describe("CLI", () => {
  it("lists, tests, dismisses, and clears alerts", async () => {
    const host = await setup({ settings: { macFallback: false } });
    const test = await host.harness.behavior.runCli(["test", "plan", "--json"]);
    expect(test.exitCode).toBe(0);
    const id = alertSchema.parse(JSON.parse(test.stdout).alert).id;

    const listed = await host.harness.behavior.runCli(["list"]);
    expect(listed.stdout).toContain("Plan review");

    const bad = await host.harness.behavior.runCli(["test", "nope"]);
    expect(bad.exitCode).not.toBe(0);

    const dismissed = await host.harness.behavior.runCli(["dismiss", id]);
    expect(dismissed.stdout).toBe(`Dismissed alert ${id}`);
    const missing = await host.harness.behavior.runCli(["dismiss", id]);
    expect(missing.exitCode).not.toBe(0);

    await host.harness.behavior.runCli(["test"]);
    await host.harness.behavior.runCli(["test", "done"]);
    const cleared = await host.harness.behavior.runCli(["clear", "--json"]);
    expect(JSON.parse(cleared.stdout)).toEqual({ dismissed: 2 });
    await host.harness.lifecycle.dispose();
  });
});
