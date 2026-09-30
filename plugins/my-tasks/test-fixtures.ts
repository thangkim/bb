import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { Task } from "./shared/contract.js";

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "01HZZZZZZZZZZZZZZZZZZZZZT1",
    projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
    number: 1,
    key: "TSK-1",
    title: "Test task",
    description: "",
    status: "todo",
    priority: "none",
    dueDate: null,
    parentTaskId: null,
    position: 0,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    labelIds: [],
    ...overrides,
  };
}

export function rpcInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(
      `expected an RPC input object, got ${JSON.stringify(input)}`,
    );
  }
  return Object.fromEntries(Object.entries(input));
}

export function makeSidebarThread(id: string): PluginSidebarThread {
  return {
    id,
    projectId: "proj_test",
    title: "Worker",
    titleFallback: null,
    displayTitle: "Worker",
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "provider-test",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/projects/proj_test/threads/${id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: 0,
    latestAttentionAt: 1,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
  };
}
