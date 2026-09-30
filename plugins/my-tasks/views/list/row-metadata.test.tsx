// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Label, Task, TaskThread } from "../../shared/contract.js";
import {
  makeSidebarThread,
  makeTask,
  rpcInput,
} from "../../test-fixtures.js";

window.matchMedia ??= (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

const app = await loadPluginApp(() => import("../../app"));

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";

const project = {
  id: PROJECT_ID,
  name: "Tasks Plugin",
  prefix: "TSK",
  nextTaskNumber: 9,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

function task(number: number, labelIds: string[] = []): Task {
  return makeTask({
    id: `01HZZZZZZZZZZZZZZZZZZZZZT${number}`,
    projectId: PROJECT_ID,
    number,
    key: `TSK-${number}`,
    title: `Task ${number}`,
    position: number,
    labelIds,
  });
}

function thread(
  taskId: string,
  liveStatus: TaskThread["liveStatus"],
  suffix: string,
): TaskThread {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZH${suffix}`,
    taskId,
    threadId: `thr_${suffix}`,
    presetName: "Sonnet · high",
    title: "Worker",
    liveStatus,
    attachedAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };
}

function label(suffix: string, name: string): Label {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZL${suffix}`,
    projectId: PROJECT_ID,
    name,
    color: "#5e6ad2",
  };
}

interface ListFixture {
  tasks: Task[];
  labels?: Label[];
  threadsByTask?: Record<string, TaskThread[]>;
  sidebarThreadIds?: string[];
}

function renderList(fixture: ListFixture) {
  const calls = { listComments: 0, listAttachments: 0 };
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: PROJECT_ID },
    {
      sidebarThreads: {
        threads: (fixture.sidebarThreadIds ?? []).map(makeSidebarThread),
      },
      rpc: {
        listProjects: () => ({ projects: [project] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listLabels: () => ({ labels: fixture.labels ?? [] }),
        listTasks: () => ({ tasks: fixture.tasks }),
        listTaskRowMeta: (input: unknown) => ({
          rowMeta: (rpcInput(input).taskIds as string[]).map((taskId) => ({
            taskId,
            threads: fixture.threadsByTask?.[taskId] ?? [],
            subtaskDone: 0,
            subtaskTotal: 0,
          })),
        }),
        listComments: () => {
          calls.listComments += 1;
          return { comments: [] };
        },
        listAttachments: () => {
          calls.listAttachments += 1;
          return { attachments: [] };
        },
      },
    },
  );
  return { slot, calls };
}

async function findRow(
  slot: { container: HTMLElement },
  key: string,
): Promise<HTMLElement> {
  return waitFor(() => {
    const row = slot.container.querySelector(`[data-task-key="${key}"]`);
    if (row === null) throw new Error(`row ${key} not found`);
    return row as HTMLElement;
  });
}

describe("list-row progress bar", () => {
  it("is always visible and animates only while a thread is actively working", async () => {
    const working = task(1);
    const idleOnly = task(2);
    const bare = task(3);
    const { slot } = renderList({
      tasks: [working, idleOnly, bare],
      threadsByTask: {
        [working.id]: [thread(working.id, "working", "W1")],
        [idleOnly.id]: [thread(idleOnly.id, "idle", "I1")],
      },
    });

    const workingRow = await findRow(slot, "TSK-1");
    const workingBar = within(workingRow).getByTitle(/agent working/);
    expect(workingBar.querySelector(".animate-pulse")).not.toBeNull();
    expect(within(workingRow).getByText("0%")).toBeTruthy();

    const idleRow = await findRow(slot, "TSK-2");
    const idleBar = within(idleRow).getByTitle(/sub-tasks done/);
    expect(idleBar.querySelector(".animate-pulse")).toBeNull();
    expect(within(idleRow).getByText("0%")).toBeTruthy();

    const bareRow = await findRow(slot, "TSK-3");
    expect(within(bareRow).getByText("0%")).toBeTruthy();
  });
});

describe("list-row attached threads", () => {
  async function clickAttachedThread(sidebarThreadIds: string[]) {
    const busy = task(1);
    const { slot } = renderList({
      tasks: [busy],
      threadsByTask: {
        [busy.id]: [thread(busy.id, "working", "W1")],
      },
      sidebarThreadIds,
    });

    const row = await findRow(slot, "TSK-1");
    expect(within(row).queryByText("Worker")).toBeNull();

    fireEvent.click(
      within(row).getByRole("button", { name: "Show attached threads" }),
    );
    fireEvent.click(
      await within(row).findByRole("button", { name: /Worker/ }),
    );
    return slot;
  }

  it("opens a sidebar thread in a split pane", async () => {
    const slot = await clickAttachedThread(["thr_W1"]);
    expect(slot.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "thr_W1",
      options: { split: true },
    });
    expect(slot.navigateCalls).toEqual([]);
  });

  it("navigates to a thread the sidebar does not know", async () => {
    const slot = await clickAttachedThread([]);
    expect(slot.sidebarActionCalls).toEqual([]);
    expect(slot.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thr_W1",
    });
  });
});

describe("list-row metadata rail", () => {
  it("fetches no comment/attachment data and renders no counts", async () => {
    const { slot, calls } = renderList({ tasks: [task(1), task(2)] });
    await waitFor(() =>
      expect(
        slot.container.querySelector('[data-task-key="TSK-1"]'),
      ).not.toBeNull(),
    );
    await waitFor(() =>
      expect(slot.getAllByRole("button").length > 0).toBe(true),
    );
    expect(calls.listComments).toBe(0);
    expect(calls.listAttachments).toBe(0);
    expect(slot.queryByTitle("Comments")).toBeNull();
    expect(slot.queryByTitle("Attachments")).toBeNull();
  });

  it("renders zero, one, and many labels with a bounded chip count", async () => {
    const labels = [
      label("A", "bug"),
      label("B", "frontend"),
      label("C", "needs-design"),
      label("D", "very-long-label-name-that-truncates"),
    ];
    const { slot } = renderList({
      tasks: [
        task(1),
        task(2, [labels[0]!.id]),
        task(
          3,
          labels.map((entry) => entry.id),
        ),
      ],
      labels,
    });
    await waitFor(() =>
      expect(
        slot.container.querySelector('[data-task-key="TSK-1"]'),
      ).not.toBeNull(),
    );

    expect(slot.getAllByText("bug").length).toBeGreaterThan(0);

    await waitFor(() => expect(slot.getByText("+2")).toBeTruthy());
    expect(slot.getByText("+3")).toBeTruthy();
    expect(slot.getByText("+2").getAttribute("title")).toBe(
      "needs-design, very-long-label-name-that-truncates",
    );
    expect(slot.getByText("+3").getAttribute("title")).toBe(
      "frontend, needs-design, very-long-label-name-that-truncates",
    );
    expect(slot.queryByText("needs-design")).toBeNull();
  });
});
