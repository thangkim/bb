import type {
  BbPluginApi,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import { publishProjectsChanged, type TasksApiStore } from "../api";
import { truncateToWidth } from "../shared/text-measure";

type ThreadResponse = PluginThreadEventPayloads["thread.created"]["thread"];

export const COMPOSE_CLAIM_TTL_MS = 10 * 60 * 1000;
const COMPOSE_CLAIM_LIMIT = 100;
export const COMPOSED_THREAD_TITLE_WIDTH = 80;

interface ComposeClaim {
  projectId: string;
  expiresAt: number;
}

export interface ComposeClaims {
  claim(bbProjectId: string, projectId: string): void;
  take(bbProjectId: string): string | null;
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
    claim(bbProjectId, projectId) {
      prune();
      claims.delete(bbProjectId);
      claims.set(bbProjectId, { projectId, expiresAt: now() + COMPOSE_CLAIM_TTL_MS });
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
      return claim.expiresAt > now() ? claim.projectId : null;
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

export function attachComposedThread(
  bb: BbPluginApi,
  store: TasksApiStore,
  claims: ComposeClaims,
  thread: ThreadResponse,
): boolean {
  if (!isComposedThread(thread)) return false;
  const projectId = claims.take(thread.projectId);
  if (projectId === null) return false;
  const project = store.tasks.getProject(projectId);
  if (!project || project.linkedBbProjectId !== thread.projectId) return false;
  store.transaction(() => {
    store.tasks.upsertProjectThread({
      projectId: project.id,
      threadId: thread.id,
      title: composedTitle(thread, project.name),
    });
    if (project.status === "backlog" || project.status === "todo") {
      store.tasks.updateProject(project.id, { status: "in_progress" });
    }
  });
  publishProjectsChanged(bb, project.id);
  return true;
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
    } catch (error) {
      bb.log.warn(
        `failed to refresh project thread title ${thread.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });
}
