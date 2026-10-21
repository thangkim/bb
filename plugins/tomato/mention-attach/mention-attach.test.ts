import {
  createFakePluginHost,
  makeMessageDispatchHookContext,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createStore } from "../api";
import { registerMentionAttach } from ".";

const PLUGIN_ID = "tomato";

function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: PLUGIN_ID });
  const store = createStore(bb);
  registerMentionAttach(bb, store);
  const project = store.tasks.createProject({
    name: "Anfra",
    prefix: "ANF",
    color: "blue",
  });
  const task = store.tasks.createTask({
    projectId: project.id,
    title: "Metric Conflict Finder",
  });
  const hook = harness.registrations.hooks["message.dispatch"];
  if (!hook) throw new Error("message.dispatch hook not registered");
  return { store, project, task, hook };
}

function mentionBlock(itemId: string, pluginId = PLUGIN_ID) {
  return {
    type: "text" as const,
    text: "Implement ANF-15",
    mentions: [
      {
        start: 10,
        end: 16,
        resource: {
          kind: "plugin" as const,
          pluginId,
          itemId,
          label: "ANF-15",
        },
      },
    ],
  };
}

function context(
  blocks: ReturnType<typeof mentionBlock>[],
  overrides: Parameters<typeof makeMessageDispatchHookContext>[0] = {},
) {
  return makeMessageDispatchHookContext({
    thread: { id: "thr_first", status: "pending", title: null },
    input: { blocks, text: "Implement ANF-15" },
    ...overrides,
  });
}

describe("attach mentioned items on first dispatch", () => {
  it("attaches the thread to a mentioned task and starts its project", async () => {
    const { store, project, task, hook } = setup();

    const decision = await hook(context([mentionBlock(task.id)]));

    expect(decision).toEqual({ action: "proceed" });
    expect(store.tasks.listTasksByThreadId("thr_first").map((t) => t.id)).toEqual(
      [task.id],
    );
    expect(store.tasks.getProject(project.id)?.status).toBe("in_progress");
  });

  it("attaches a mentioned project at the project level", async () => {
    const { store, project, hook } = setup();

    await hook(context([mentionBlock(project.id)]));

    expect(
      store.tasks.listProjectsByThreadId("thr_first").map((p) => p.id),
    ).toEqual([project.id]);
    expect(store.tasks.listTasksByThreadId("thr_first")).toEqual([]);
  });

  it("does not add a project link when its task is also mentioned", async () => {
    const { store, project, task, hook } = setup();

    await hook(context([mentionBlock(task.id), mentionBlock(project.id)]));

    expect(store.tasks.listTasksByThreadId("thr_first")).toHaveLength(1);
    expect(store.tasks.listProjectsByThreadId("thr_first")).toEqual([]);
  });

  it("ignores mentions from other plugins", async () => {
    const { store, task, hook } = setup();

    await hook(context([mentionBlock(task.id, "someone-else")]));

    expect(store.tasks.listTasksByThreadId("thr_first")).toEqual([]);
  });

  it("ignores unknown ids and still proceeds", async () => {
    const { store, hook } = setup();

    const decision = await hook(context([mentionBlock("missing-id")]));

    expect(decision).toEqual({ action: "proceed" });
    expect(store.tasks.listTasksByThreadId("thr_first")).toEqual([]);
  });

  it("leaves a thread that is already linked alone", async () => {
    const { store, project, task, hook } = setup();
    const other = store.tasks.createTask({
      projectId: project.id,
      title: "Already tracked",
    });
    store.tasks.upsertTaskThread({
      taskId: other.id,
      threadId: "thr_first",
      presetName: "Attached",
      title: "Already tracked",
      liveStatus: "idle",
    });

    await hook(context([mentionBlock(task.id)]));

    expect(store.tasks.listTasksByThreadId("thr_first").map((t) => t.id)).toEqual(
      [other.id],
    );
  });

  it("skips join-turn attempts and threads started by agents", async () => {
    const { store, task, hook } = setup();

    await hook(context([mentionBlock(task.id)], { attempt: "join-turn" }));
    await hook(
      context([mentionBlock(task.id)], {
        thread: { id: "thr_first", parentThreadId: "thr_parent" },
      }),
    );

    expect(store.tasks.listTasksByThreadId("thr_first")).toEqual([]);
  });
});
