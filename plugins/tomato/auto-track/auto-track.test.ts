import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { registerAgentConfiguration } from "../agents";
import { createStore } from "../api";
import {
  TOMATO_SKILL,
  READ_BRIEF_TOOL,
  registerProjectBrief,
} from "../brief";
import { registerAutoTrack, TRACK_THREAD_TOOL } from ".";

function setup(options: { enabled?: boolean } = {}) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "tasks",
    agentSkillIds: [TOMATO_SKILL],
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) =>
          makeThreadResponse({ id: threadId, status: "active" }),
      },
    },
  });
  const store = createStore(bb);
  registerProjectBrief(bb, store);
  registerAutoTrack(bb, store);
  registerAgentConfiguration(bb, store, () => options.enabled ?? true);
  const linked = store.tasks.createProject({
    name: "Task plugin",
    prefix: "TP",
    color: "blue",
    linkedBbProjectId: "proj_bb",
    description: "## Problem\n\nThreads are not tracked as tasks.",
  });
  const unlinked = store.tasks.createProject({
    name: "Branch selector",
    prefix: "BS",
    color: "green",
  });
  const elsewhere = store.tasks.createProject({
    name: "Other repo",
    prefix: "OR",
    color: "red",
    linkedBbProjectId: "proj_other",
  });
  const finished = store.tasks.createProject({
    name: "Shipped",
    prefix: "SH",
    color: "red",
    linkedBbProjectId: "proj_bb",
    status: "done",
  });
  return { harness, store, linked, unlinked, elsewhere, finished };
}

function resolve(
  harness: ReturnType<typeof setup>["harness"],
  overrides: {
    threadId?: string;
    parentThreadId?: string | null;
    origin?: { kind: "fork" | null; pluginId: string | null };
  } = {},
) {
  return harness.resolveAgentConfiguration(
    makePluginAgentConfigurationContext({
      thread: {
        id: overrides.threadId ?? "thr_new",
        title: null,
        parentThreadId: overrides.parentThreadId ?? null,
        sourceThreadId: null,
      },
      project: { id: "proj_bb" },
      ...(overrides.origin ? { origin: overrides.origin } : {}),
    }),
  );
}

function text(result: unknown): string {
  if (typeof result === "string") return result;
  const parts = (result as { content: { text: string }[] }).content;
  return parts.map((part) => part.text).join("");
}

describe("auto-track new threads", () => {
  it("offers untracked threads the tool with open projects for their bb project and the user's title style", async () => {
    const { harness, store, linked } = setup();
    store.tasks.createTask({
      projectId: linked.id,
      title: "Noti for terminal",
    });
    store.tasks.createTask({
      projectId: linked.id,
      title: "1. Scaffold the extension",
    });
    store.tasks.createTask({
      projectId: linked.id,
      title:
        "Make the side panel remember every scroll position across reloads",
    });

    const config = await resolve(harness);

    expect(config.tools.map((tool) => tool.name)).toEqual([TRACK_THREAD_TOOL]);
    expect(config.instructions).toContain(
      '- TP "Task plugin": Threads are not tracked as tasks.',
    );
    expect(config.instructions).toContain('- BS "Branch selector"');
    expect(config.instructions).not.toContain("OR ");
    expect(config.instructions).not.toContain("SH ");
    expect(config.instructions).toContain(`"Noti for terminal"`);
    expect(config.instructions).not.toContain("Scaffold");
    expect(config.instructions).not.toContain("scroll position");
  });

  it("skips tracked threads, side chats, child threads, and the disabled setting", async () => {
    const { harness, store, linked } = setup();
    store.tasks.upsertProjectThread({
      projectId: linked.id,
      threadId: "thr_project",
      title: "Project thread",
    });

    const projectThread = await resolve(harness, { threadId: "thr_project" });
    expect(projectThread.tools.map((tool) => tool.name)).toContain(
      READ_BRIEF_TOOL,
    );
    expect(projectThread.instructions).not.toContain(TRACK_THREAD_TOOL);

    const sideChat = await resolve(harness, {
      origin: { kind: "fork", pluginId: "side-chat" },
    });
    expect(sideChat.tools).toEqual([]);

    const child = await resolve(harness, { parentThreadId: "thr_parent" });
    expect(child.tools).toEqual([]);

    const disabled = setup({ enabled: false });
    expect((await resolve(disabled.harness)).tools).toEqual([]);
  });

  it("creates the task in the chosen project and attaches the thread once", async () => {
    const { harness, store, unlinked } = setup();

    const result = await harness.callAgentTool(
      TRACK_THREAD_TOOL,
      { project: "bs", title: "Test on staging." },
      { threadId: "thr_new" },
    );

    expect(text(result)).toBe(
      'Tracked this thread as BS-1 "Test on staging" in BS.',
    );
    const [task] = store.tasks.listTasksByThreadId("thr_new");
    expect(task).toMatchObject({
      projectId: unlinked.id,
      title: "Test on staging",
    });
    expect(harness.realtimeSignals).toContainEqual({
      channel: "threads:changed",
      payload: { taskId: task!.id },
    });

    const again = await harness.callAgentTool(
      TRACK_THREAD_TOOL,
      { project: "TP", title: "Something else" },
      { threadId: "thr_new" },
    );
    expect(text(again)).toBe("This thread is already tracked as BS-1.");
    expect(store.tasks.listTasks()).toHaveLength(1);
  });

  it("rejects an unknown project without creating a task", async () => {
    const { harness, store } = setup();

    const result = await harness.callAgentTool(
      TRACK_THREAD_TOOL,
      { project: "NOPE", title: "Fix empty space" },
      { threadId: "thr_new" },
    );

    expect(text(result)).toMatch(/project not found: NOPE/);
    expect(store.tasks.listTasks()).toHaveLength(0);
  });
});
