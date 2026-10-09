import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createStore } from "../api";
import { COMPOSE_CLAIM_TTL_MS, createComposeClaims } from "./compose";
import { delegationRpcContract } from "./contract";
import { registerDelegation } from ".";

function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  const store = createStore(bb);
  registerDelegation(bb, store);
  const project = store.tasks.createProject({
    name: "Launch",
    prefix: "LCH",
    color: "blue",
    linkedBbProjectId: "proj_launch",
  });
  return { harness, store, project };
}

async function compose(
  harness: ReturnType<typeof setup>["harness"],
  projectId: string,
) {
  return delegationRpcContract.projectThreadsCompose.output.parse(
    await harness.callRpc("projectThreadsCompose", { projectId }),
  );
}

describe("project composer threads", () => {
  it("attaches the next thread created in the linked bb project and starts the project", async () => {
    const { harness, store, project } = setup();
    expect(await compose(harness, project.id)).toEqual({
      bbProjectId: "proj_launch",
    });

    await harness.emitThreadEvent("thread.created", {
      thread: makeThreadResponse({
        id: "thr_typed",
        projectId: "proj_launch",
        titleFallback: "Investigate the flaky import",
      }),
    });
    await harness.emitThreadEvent("thread.created", {
      thread: makeThreadResponse({ id: "thr_later", projectId: "proj_launch" }),
    });

    expect(store.tasks.listProjectThreads(project.id)).toEqual([
      expect.objectContaining({
        threadId: "thr_typed",
        title: "Investigate the flaky import",
      }),
    ]);
    expect(store.tasks.getProject(project.id)?.status).toBe("in_progress");
    expect(harness.realtimeSignals).toContainEqual({
      channel: "projects:changed",
      payload: { projectId: project.id },
    });
  });

  it("ignores forks, child threads, plugin spawns, and other projects", async () => {
    const { harness, store, project } = setup();
    await compose(harness, project.id);

    for (const thread of [
      makeThreadResponse({ id: "thr_other", projectId: "proj_other" }),
      makeThreadResponse({
        id: "thr_fork",
        projectId: "proj_launch",
        originKind: "fork",
        visibility: "hidden",
      }),
      makeThreadResponse({
        id: "thr_child",
        projectId: "proj_launch",
        parentThreadId: "thr_parent",
      }),
      makeThreadResponse({
        id: "thr_plugin",
        projectId: "proj_launch",
        originPluginId: "tasks",
      }),
    ]) {
      await harness.emitThreadEvent("thread.created", { thread });
    }
    expect(store.tasks.listProjectThreads(project.id)).toEqual([]);

    await harness.emitThreadEvent("thread.created", {
      thread: makeThreadResponse({ id: "thr_user", projectId: "proj_launch" }),
    });
    expect(
      store.tasks.listProjectThreads(project.id).map((entry) => entry.threadId),
    ).toEqual(["thr_user"]);
  });

  it("attaches nothing without a claim and refuses unlinked projects", async () => {
    const { harness, store, project } = setup();
    await harness.emitThreadEvent("thread.created", {
      thread: makeThreadResponse({ id: "thr_plain", projectId: "proj_launch" }),
    });
    expect(store.tasks.listProjectThreads(project.id)).toEqual([]);

    const unlinked = store.tasks.createProject({
      name: "Loose",
      prefix: "LSE",
      color: "green",
    });
    await expect(compose(harness, unlinked.id)).rejects.toThrow(
      /not linked to a bb project/,
    );
  });

  it("renames an attached project thread once bb titles it", async () => {
    const { harness, store, project } = setup();
    await compose(harness, project.id);
    await harness.emitThreadEvent("thread.created", {
      thread: makeThreadResponse({
        id: "thr_typed",
        projectId: "proj_launch",
        titleFallback: "investigate why the import keeps failing on",
      }),
    });
    await harness.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({
        id: "thr_typed",
        projectId: "proj_launch",
        title: "Flaky import investigation",
      }),
      lastAssistantText: null,
    });
    expect(store.tasks.listProjectThreads(project.id)).toEqual([
      expect.objectContaining({ title: "Flaky import investigation" }),
    ]);
  });

  it("expires claims and keeps only the latest claim per bb project", () => {
    let now = 0;
    const claims = createComposeClaims(() => now);
    claims.claim("proj_a", { kind: "project", projectId: "first" });
    claims.claim("proj_a", { kind: "task", taskId: "second" });
    expect(claims.take("proj_a")).toEqual({ kind: "task", taskId: "second" });
    expect(claims.take("proj_a")).toBeNull();
    claims.claim("proj_b", { kind: "project", projectId: "late" });
    now = COMPOSE_CLAIM_TTL_MS + 1;
    expect(claims.take("proj_b")).toBeNull();
  });
});

describe("task composer threads", () => {
  it("attaches the next composed thread to the task and renames it once bb titles it", async () => {
    const { harness, store, project } = setup();
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Fix the importer",
    });
    expect(
      delegationRpcContract.taskThreadsCompose.output.parse(
        await harness.callRpc("taskThreadsCompose", { taskId: task.id }),
      ),
    ).toEqual({ bbProjectId: "proj_launch" });

    await harness.emitThreadEvent("thread.created", {
      thread: makeThreadResponse({
        id: "thr_task",
        projectId: "proj_launch",
        titleFallback: "look at the importer",
      }),
    });

    expect(store.tasks.listTaskThreads(task.id)).toEqual([
      expect.objectContaining({
        threadId: "thr_task",
        title: "look at the importer",
        presetName: "Attached",
      }),
    ]);
    expect(store.tasks.listProjectThreads(project.id)).toEqual([]);
    expect(store.tasks.getProject(project.id)?.status).toBe("in_progress");
    expect(harness.realtimeSignals).toContainEqual({
      channel: "threads:changed",
      payload: { taskId: task.id },
    });

    await harness.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({
        id: "thr_task",
        projectId: "proj_launch",
        title: "Importer fix",
      }),
      lastAssistantText: null,
    });
    expect(store.tasks.listTaskThreads(task.id)).toEqual([
      expect.objectContaining({ title: "Importer fix" }),
    ]);
  });

  it("refuses tasks in unlinked projects", async () => {
    const { harness, store } = setup();
    const unlinked = store.tasks.createProject({
      name: "Loose",
      prefix: "LSE",
      color: "green",
    });
    const task = store.tasks.createTask({
      projectId: unlinked.id,
      title: "Orphan",
    });
    await expect(
      harness.callRpc("taskThreadsCompose", { taskId: task.id }),
    ).rejects.toThrow(/not linked to a bb project/);
  });
});

describe("split threads", () => {
  function splitSetup() {
    const context = setup();
    const task = context.store.tasks.createTask({
      projectId: context.project.id,
      title: "Fix the importer",
    });
    const source = makeThreadResponse({
      id: "thr_source",
      projectId: "proj_launch",
      createdAt: 0,
    });
    const threads = new Map([[source.id, source]]);
    context.harness.sdk.stub(
      "threads.get",
      ({ threadId }: { threadId: string }) => threads.get(threadId),
    );
    context.store.tasks.upsertTaskThread({
      taskId: task.id,
      threadId: source.id,
      presetName: "Attached",
      title: "source",
      liveStatus: "idle",
    });
    context.store.tasks.upsertProjectThread({
      projectId: context.project.id,
      threadId: source.id,
      title: "source",
    });
    const addThread = (overrides: Parameters<typeof makeThreadResponse>[0]) => {
      const thread = makeThreadResponse({
        projectId: "proj_launch",
        createdAt: Date.now(),
        ...overrides,
      });
      threads.set(thread.id, thread);
      return thread;
    };
    const split = async (threadId: string, paneAgeMs = 2_000) =>
      delegationRpcContract.threadSplitAttach.output.parse(
        await context.harness.callRpc("threadSplitAttach", {
          sourceThreadId: source.id,
          threadId,
          paneAgeMs,
        }),
      );
    return { ...context, task, addThread, split };
  }

  it("attaches a thread created in a split to the source thread's tasks and projects", async () => {
    const { harness, store, project, task, addThread, split } = splitSetup();
    addThread({ id: "thr_split", titleFallback: "split work", status: "active" });

    expect(await split("thr_split")).toEqual({
      taskIds: [task.id],
      projectIds: [project.id],
    });
    expect(store.tasks.listTaskThreads(task.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          threadId: "thr_split",
          title: "split work",
          presetName: "Attached",
          liveStatus: "working",
        }),
      ]),
    );
    expect(store.tasks.listProjectThreads(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ threadId: "thr_split", title: "split work" }),
      ]),
    );
    expect(harness.realtimeSignals).toContainEqual({
      channel: "threads:changed",
      payload: { taskId: task.id },
    });
  });

  it("ignores existing threads opened in a split, other projects, and non-composed threads", async () => {
    const { store, task, addThread, split } = splitSetup();
    addThread({ id: "thr_old", createdAt: Date.now() - 60_000 });
    addThread({ id: "thr_other", projectId: "proj_other" });
    addThread({ id: "thr_fork", originKind: "fork" });

    for (const threadId of ["thr_old", "thr_other", "thr_fork", "thr_source"]) {
      expect(await split(threadId)).toEqual({ taskIds: [], projectIds: [] });
    }
    expect(
      store.tasks.listTaskThreads(task.id).map((thread) => thread.threadId),
    ).toEqual(["thr_source"]);
  });

  it("leaves threads claimed by My Tasks New thread to their own target", async () => {
    const { harness, store, task, addThread, split } = splitSetup();
    const other = store.tasks.createTask({
      projectId: task.projectId,
      title: "Other",
    });
    await harness.callRpc("taskThreadsCompose", { taskId: other.id });
    const thread = addThread({ id: "thr_claimed" });

    expect(await split("thr_claimed")).toEqual({ taskIds: [], projectIds: [] });
    await harness.emitThreadEvent("thread.created", { thread });
    expect(await split("thr_claimed")).toEqual({ taskIds: [], projectIds: [] });
    expect(store.tasks.listTasksByThreadId("thr_claimed")).toEqual([
      expect.objectContaining({ id: other.id }),
    ]);
  });
});
