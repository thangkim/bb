import type {
  BbPluginApi,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import {
  publishProjectsChanged,
  publishTasksChanged,
  type TasksApiStore,
} from "../api";
import type { Project, TaskThreadLiveStatus } from "../db";
import type { ThreadsChangedEvent } from "../shared/contract";
import { truncateToWidth } from "../shared/text-measure";

type ThreadResponse = PluginThreadEventPayloads["thread.created"]["thread"];

export const COMPOSE_CLAIM_TTL_MS = 10 * 60 * 1000;
const COMPOSE_CLAIM_LIMIT = 100;
export const COMPOSED_THREAD_TITLE_WIDTH = 80;
export const MANUAL_PRESET_NAME = "Attached";
export const SPLIT_ATTACH_LATENCY_MS = 5_000;

export type ComposeTarget =
  | { kind: "project"; projectId: string }
  | { kind: "task"; taskId: string };

interface ComposeClaim {
  target: ComposeTarget;
  expiresAt: number;
}

export interface ComposeClaims {
  claim(bbProjectId: string, target: ComposeTarget): void;
  take(bbProjectId: string): ComposeTarget | null;
  has(bbProjectId: string): boolean;
}

export function publishThreadsChanged(bb: BbPluginApi, taskId: string): void {
  const payload: ThreadsChangedEvent = { taskId };
  bb.realtime.publish("threads:changed", payload);
}

export function createComposeClaims(now: () => number = Date.now): ComposeClaims {
  const claims = new Map<string, ComposeClaim>();
  const prune = () => {
    const time = now();
    for (const [key, claim] of claims) {
      if (claim.expiresAt <= time) claims.delete(key);
    }
  };
  return {
    claim(bbProjectId, target) {
      prune();
      claims.delete(bbProjectId);
      claims.set(bbProjectId, { target, expiresAt: now() + COMPOSE_CLAIM_TTL_MS });
      while (claims.size > COMPOSE_CLAIM_LIMIT) {
        const oldest = claims.keys().next().value;
        if (oldest === undefined) break;
        claims.delete(oldest);
      }
    },
    take(bbProjectId) {
      const claim = claims.get(bbProjectId);
      if (!claim) return null;
      claims.delete(bbProjectId);
      return claim.expiresAt > now() ? claim.target : null;
    },
    has(bbProjectId) {
      const claim = claims.get(bbProjectId);
      return claim !== undefined && claim.expiresAt > now();
    },
  };
}

const claimsByHost = new WeakMap<BbPluginApi, ComposeClaims>();

export function composeClaimsFor(bb: BbPluginApi): ComposeClaims {
  let claims = claimsByHost.get(bb);
  if (!claims) {
    claims = createComposeClaims();
    claimsByHost.set(bb, claims);
  }
  return claims;
}

export function isComposedThread(thread: ThreadResponse): boolean {
  return (
    thread.parentThreadId === null &&
    thread.originKind === null &&
    thread.originPluginId === null &&
    thread.visibility === "visible"
  );
}

function composedTitle(thread: ThreadResponse, fallback: string): string {
  return truncateToWidth(
    thread.title?.trim() || thread.titleFallback?.trim() || fallback,
    COMPOSED_THREAD_TITLE_WIDTH,
  );
}

function startProject(store: TasksApiStore, project: Project): void {
  if (project.status === "backlog" || project.status === "todo") {
    store.tasks.updateProject(project.id, { status: "in_progress" });
  }
}

export function attachComposedThread(
  bb: BbPluginApi,
  store: TasksApiStore,
  claims: ComposeClaims,
  thread: ThreadResponse,
): boolean {
  if (!isComposedThread(thread)) return false;
  const target = claims.take(thread.projectId);
  if (target === null) return false;
  if (target.kind === "task") {
    const task = store.tasks.getTask(target.taskId);
    if (!task) return false;
    const project = store.tasks.getProject(task.projectId);
    if (!project || project.linkedBbProjectId !== thread.projectId) return false;
    store.transaction(() => {
      store.tasks.upsertTaskThread({
        taskId: task.id,
        threadId: thread.id,
        presetName: MANUAL_PRESET_NAME,
        title: composedTitle(thread, task.title),
        liveStatus: "starting",
      });
      startProject(store, project);
    });
    publishThreadsChanged(bb, task.id);
    publishTasksChanged(bb, task.id, task.projectId);
    publishProjectsChanged(bb, project.id);
    return true;
  }
  const project = store.tasks.getProject(target.projectId);
  if (!project || project.linkedBbProjectId !== thread.projectId) return false;
  store.transaction(() => {
    store.tasks.upsertProjectThread({
      projectId: project.id,
      threadId: thread.id,
      title: composedTitle(thread, project.name),
    });
    startProject(store, project);
  });
  publishProjectsChanged(bb, project.id);
  return true;
}

export interface SplitAttachInput {
  source: ThreadResponse;
  thread: ThreadResponse;
  paneAgeMs: number;
  liveStatus: TaskThreadLiveStatus;
  now: number;
}

export interface SplitAttachResult {
  taskIds: string[];
  projectIds: string[];
}

const NOTHING_ATTACHED: SplitAttachResult = { taskIds: [], projectIds: [] };

export function attachSplitThread(
  bb: BbPluginApi,
  store: TasksApiStore,
  claims: ComposeClaims,
  input: SplitAttachInput,
): SplitAttachResult {
  const { source, thread } = input;
  if (
    thread.id === source.id ||
    !isComposedThread(thread) ||
    thread.projectId !== source.projectId ||
    thread.createdAt < input.now - input.paneAgeMs - SPLIT_ATTACH_LATENCY_MS ||
    claims.has(thread.projectId) ||
    store.tasks.listTaskThreadsByThreadId(thread.id).length > 0 ||
    store.tasks.listProjectsByThreadId(thread.id).length > 0
  ) {
    return NOTHING_ATTACHED;
  }
  const tasks = store.tasks.listTasksByThreadId(source.id);
  const projects = store.tasks.listProjectsByThreadId(source.id);
  if (tasks.length === 0 && projects.length === 0) return NOTHING_ATTACHED;
  store.transaction(() => {
    for (const task of tasks) {
      store.tasks.upsertTaskThread({
        taskId: task.id,
        threadId: thread.id,
        presetName: MANUAL_PRESET_NAME,
        title: composedTitle(thread, task.title),
        liveStatus: input.liveStatus,
      });
    }
    for (const project of projects) {
      store.tasks.upsertProjectThread({
        projectId: project.id,
        threadId: thread.id,
        title: composedTitle(thread, project.name),
      });
    }
  });
  for (const task of tasks) {
    publishThreadsChanged(bb, task.id);
    publishTasksChanged(bb, task.id, task.projectId);
  }
  const projectIds = [
    ...new Set([
      ...tasks.map((task) => task.projectId),
      ...projects.map((project) => project.id),
    ]),
  ];
  for (const projectId of projectIds) publishProjectsChanged(bb, projectId);
  return {
    taskIds: tasks.map((task) => task.id),
    projectIds: projects.map((project) => project.id),
  };
}

export function refreshProjectThreadTitles(
  bb: BbPluginApi,
  store: TasksApiStore,
  thread: ThreadResponse,
): void {
  const title = thread.title?.trim();
  if (!title) return;
  const next = truncateToWidth(title, COMPOSED_THREAD_TITLE_WIDTH);
  for (const project of store.tasks.listProjectsByThreadId(thread.id)) {
    const current = store.tasks.getProjectThreadByThreadId(project.id, thread.id);
    if (!current || current.title === next) continue;
    store.tasks.upsertProjectThread({
      projectId: project.id,
      threadId: thread.id,
      title: next,
    });
    publishProjectsChanged(bb, project.id);
  }
}

export function refreshComposedTaskThreadTitles(
  bb: BbPluginApi,
  store: TasksApiStore,
  thread: ThreadResponse,
): void {
  const title = thread.title?.trim();
  if (!title) return;
  const next = truncateToWidth(title, COMPOSED_THREAD_TITLE_WIDTH);
  for (const current of store.tasks.listTaskThreadsByThreadId(thread.id)) {
    if (current.presetName !== MANUAL_PRESET_NAME || current.title === next) {
      continue;
    }
    store.tasks.upsertTaskThread({
      taskId: current.taskId,
      threadId: current.threadId,
      presetName: current.presetName,
      title: next,
      liveStatus: current.liveStatus,
    });
    publishThreadsChanged(bb, current.taskId);
  }
}

export function registerComposeAttach(
  bb: BbPluginApi,
  store: TasksApiStore,
): void {
  const claims = composeClaimsFor(bb);
  bb.events.on("thread.created", ({ thread }) => {
    try {
      attachComposedThread(bb, store, claims, thread);
    } catch (error) {
      bb.log.warn(
        `failed to attach composed thread ${thread.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });
  bb.events.on("thread.idle", ({ thread }) => {
    try {
      refreshProjectThreadTitles(bb, store, thread);
      refreshComposedTaskThreadTitles(bb, store, thread);
    } catch (error) {
      bb.log.warn(
        `failed to refresh composed thread title ${thread.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });
}
