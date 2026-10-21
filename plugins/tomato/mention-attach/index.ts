import type {
  BbPluginApi,
  MessageDispatchHookContext,
} from "@get-bb/plugin-sdk";

import {
  publishProjectsChanged,
  publishTasksChanged,
  type TasksApiStore,
} from "../api";
import {
  composedTitle,
  isComposedThread,
  MANUAL_PRESET_NAME,
  publishThreadsChanged,
  startProject,
} from "../delegate/compose";

function mentionedItemIds(
  pluginId: string,
  blocks: MessageDispatchHookContext["input"]["blocks"],
): string[] {
  const ids = new Set<string>();
  for (const block of blocks) {
    if (block.type !== "text") continue;
    for (const mention of block.mentions) {
      const { resource } = mention;
      if (resource.kind === "plugin" && resource.pluginId === pluginId) {
        ids.add(resource.itemId);
      }
    }
  }
  return [...ids];
}

export function attachMentionedItems(
  bb: BbPluginApi,
  store: TasksApiStore,
  context: MessageDispatchHookContext,
): void {
  const { thread } = context;
  if (context.attempt !== "start-turn" || !isComposedThread(thread)) return;
  const itemIds = mentionedItemIds(bb.pluginId, context.input.blocks);
  if (itemIds.length === 0) return;
  if (
    store.tasks.listTasksByThreadId(thread.id).length > 0 ||
    store.tasks.listProjectsByThreadId(thread.id).length > 0
  ) {
    return;
  }

  const tasks = itemIds.flatMap((id) => store.tasks.getTask(id) ?? []);
  const taskProjectIds = new Set(tasks.map((task) => task.projectId));
  const projects = itemIds.flatMap((id) => {
    const project = store.tasks.getProject(id);
    return project && !taskProjectIds.has(project.id) ? [project] : [];
  });
  if (tasks.length === 0 && projects.length === 0) return;

  const started = new Map(
    [...taskProjectIds].flatMap((id) => {
      const project = store.tasks.getProject(id);
      return project ? [[id, project] as const] : [];
    }),
  );
  store.transaction(() => {
    for (const task of tasks) {
      store.tasks.upsertTaskThread({
        taskId: task.id,
        threadId: thread.id,
        presetName: MANUAL_PRESET_NAME,
        title: composedTitle(thread, task.title),
        liveStatus: "starting",
      });
    }
    for (const project of projects) {
      store.tasks.upsertProjectThread({
        projectId: project.id,
        threadId: thread.id,
        title: composedTitle(thread, project.name),
      });
      started.set(project.id, project);
    }
    for (const project of started.values()) startProject(store, project);
  });

  for (const task of tasks) {
    publishThreadsChanged(bb, task.id);
    publishTasksChanged(bb, task.id, task.projectId);
  }
  for (const projectId of started.keys()) publishProjectsChanged(bb, projectId);
}

export function registerMentionAttach(
  bb: BbPluginApi,
  store: TasksApiStore,
): void {
  bb.experimental_hooks.on("message.dispatch", (context) => {
    try {
      attachMentionedItems(bb, store, context);
    } catch (error) {
      bb.log.warn(
        `failed to attach mentioned items to ${context.thread.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return { action: "proceed" };
  });
}
