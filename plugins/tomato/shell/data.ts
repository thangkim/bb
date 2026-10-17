import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import { tasksRpcContract, type TasksRpcContract } from "../shared/contract.js";
import type { Task, Priority, TaskStatus } from "../shared/contract.js";
import { errorMessage } from "../shared/errors.js";
import { TASKS_PAGE_MAX_LIMIT, type TaskSort } from "../shared/pagination.js";
import type { MentionItem } from "../editor/extensions.js";
import {
  claimQuerySnapshotRevision,
  readQuerySnapshot,
  writeQuerySnapshot,
} from "./query-snapshot.js";
import { useTasksRefresh } from "./refresh.js";

export function useTasksRpc() {
  return useRpc<TasksRpcContract>();
}

export type TasksRpc = ReturnType<typeof useTasksRpc>;

interface TaskListQuery {
  projectId?: string;
  statuses?: TaskStatus[];
  priorities?: Priority[];
  labelIds?: string[];
  activeOnly?: boolean;
  search?: string;
  sort?: TaskSort;
}

export async function listAllTasks(
  rpc: TasksRpc,
  input: TaskListQuery = {},
): Promise<Task[]> {
  const tasks: Task[] = [];
  let cursor: string | undefined;
  do {
    const page = await rpc.call("listTasks", {
      ...input,
      limit: TASKS_PAGE_MAX_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    tasks.push(...page.tasks);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return tasks;
}

const INVALIDATION_CHANNELS = [
  "tasks:changed",
  "projects:changed",
  "comments:changed",
  "threads:changed",
] as const;

type InvalidationChannel = (typeof INVALIDATION_CHANNELS)[number];

interface InvalidationScope {
  taskId?: string;
  projectId?: string;
}

function payloadId(
  payload: unknown,
  key: keyof InvalidationScope,
): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  if (!(key in payload)) return undefined;
  const value: unknown = Reflect.get(payload, key);
  return typeof value === "string" ? value : undefined;
}

function outOfScope(scope: InvalidationScope, payload: unknown): boolean {
  return (["taskId", "projectId"] as const).some((key) => {
    const expected = scope[key];
    const changed = payloadId(payload, key);
    return (
      expected !== undefined && changed !== undefined && changed !== expected
    );
  });
}

function useInvalidation(
  channels: readonly InvalidationChannel[],
  onInvalidate: () => void,
  scope: InvalidationScope,
): void {
  const ref = useRef({ channels, onInvalidate, scope });
  ref.current = { channels, onInvalidate, scope };
  const fire = useCallback((channel: InvalidationChannel, payload: unknown) => {
    const current = ref.current;
    if (!current.channels.includes(channel)) return;
    if (outOfScope(current.scope, payload)) return;
    current.onInvalidate();
  }, []);
  useRealtime("tasks:changed", (payload) => fire("tasks:changed", payload));
  useRealtime("projects:changed", (payload) =>
    fire("projects:changed", payload),
  );
  useRealtime("comments:changed", (payload) =>
    fire("comments:changed", payload),
  );
  useRealtime("threads:changed", (payload) => fire("threads:changed", payload));
}

const NO_SCOPE: InvalidationScope = {};

interface TasksQuery<T> {
  data: T | undefined;
  error: string | null;
  isLoading: boolean;
  refresh: () => void;
}

interface TasksQuerySnapshot<T> {
  name: string;
  schema: z.ZodType<T>;
}

export function useTasksQuery<T>(
  fetcher: (rpc: TasksRpc) => Promise<T>,
  channels: readonly InvalidationChannel[],
  deps: readonly unknown[] = [],
  options: {
    snapshot?: TasksQuerySnapshot<T>;
    scope?: InvalidationScope;
  } = {},
): TasksQuery<T> {
  const rpc = useTasksRpc();
  const { generation, beginGenerationWork, endGenerationWork } =
    useTasksRefresh();
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const snapshotRef = useRef(options.snapshot);
  snapshotRef.current = options.snapshot;
  const [state, setState] = useState<{
    data: T | undefined;
    error: string | null;
    isLoading: boolean;
  }>(() => ({
    data:
      options.snapshot === undefined
        ? undefined
        : readQuerySnapshot(options.snapshot.name, options.snapshot.schema),
    error: null,
    isLoading: true,
  }));
  const seqRef = useRef(0);
  const previousGenerationRef = useRef(generation);
  const depsKey = JSON.stringify(deps);
  const dataDepsKeyRef = useRef(depsKey);
  const refresh = useCallback(() => {
    const seq = ++seqRef.current;
    const snapshot = snapshotRef.current;
    const snapshotRevision =
      snapshot === undefined ? 0 : claimQuerySnapshotRevision(snapshot.name);
    return fetcherRef.current(rpc).then(
      (data) => {
        if (snapshot !== undefined) {
          writeQuerySnapshot(snapshot.name, data, snapshotRevision);
        }
        if (seq !== seqRef.current) return;
        dataDepsKeyRef.current = depsKey;
        setState({ data, error: null, isLoading: false });
      },
      (error: unknown) => {
        if (seq !== seqRef.current) return;
        const keepsData = dataDepsKeyRef.current === depsKey;
        setState((current) => ({
          data: keepsData ? current.data : undefined,
          error: errorMessage(error),
          isLoading: false,
        }));
      },
    );
  }, [rpc, depsKey]);
  useEffect(() => {
    const generationBumped = previousGenerationRef.current !== generation;
    previousGenerationRef.current = generation;
    setState((current) => ({ ...current, isLoading: true }));
    if (generationBumped) beginGenerationWork();
    let settled = false;
    const finish = () => {
      if (!generationBumped || settled) return;
      settled = true;
      endGenerationWork();
    };
    void refresh().finally(finish);
    return () => {
      finish();
    };
  }, [refresh, generation, beginGenerationWork, endGenerationWork]);
  useInvalidation(channels, refresh, options.scope ?? NO_SCOPE);
  return { ...state, refresh };
}

const foldersSnapshot = {
  name: "folders",
  schema: tasksRpcContract.listFolders.output.shape.folders,
};

export function useFolders() {
  return useTasksQuery(
    async (rpc) => (await rpc.call("listFolders")).folders,
    ["projects:changed"],
    [],
    { snapshot: foldersSnapshot },
  );
}

const projectsSnapshot = {
  name: "projects",
  schema: tasksRpcContract.listProjects.output.shape.projects,
};

export function useProjects() {
  return useTasksQuery(
    async (rpc) => (await rpc.call("listProjects", {})).projects,
    ["projects:changed"],
    [],
    { snapshot: projectsSnapshot },
  );
}

export function usePresets() {
  return useTasksQuery(
    async (rpc) => (await rpc.call("listPresets")).presets,
    ["projects:changed"],
  );
}

const sidebarSummarySnapshot = {
  name: "sidebar-summary",
  schema: tasksRpcContract.sidebarSummary.output.shape.projects,
};

export function useSidebarSummary() {
  return useTasksQuery(
    async (rpc) => (await rpc.call("sidebarSummary")).projects,
    ["tasks:changed", "projects:changed", "threads:changed"],
    [],
    { snapshot: sidebarSummarySnapshot },
  );
}

export function useMentionItems() {
  const rpc = useTasksRpc();
  return useCallback(
    async (query: string): Promise<MentionItem[]> => {
      const trimmed = query.trim();
      const [taskResult, threadResult] = await Promise.all([
        rpc.call("listTasks", {
          ...(trimmed ? { search: trimmed } : {}),
          limit: 8,
        }),
        rpc
          .call("searchThreads", { query: trimmed, limit: 5 })
          .catch(() => ({ threads: [] })),
      ]);
      return [
        ...taskResult.tasks.slice(0, 8).map((task) => ({
          type: "task" as const,
          id: task.id,
          key: task.key,
          title: task.title,
        })),
        ...threadResult.threads.map((thread) => ({
          type: "thread" as const,
          id: thread.id,
          title: thread.title,
        })),
      ];
    },
    [rpc],
  );
}
