// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import type { Task } from "../../shared/contract.js";
import { makeTask } from "../../test-fixtures.js";

window.matchMedia = (query: string) => ({
  matches: query === COMPACT_VIEWPORT_QUERY,
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
  nextTaskNumber: 5,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

function task(
  number: number,
  status: Task["status"],
  priority: Task["priority"],
  dueDate: string | null,
): Task {
  return makeTask({
    id: `01HZZZZZZZZZZZZZZZZZZZZZT${number}`,
    projectId: PROJECT_ID,
    number,
    key: `TSK-${number}`,
    title: `Task ${number}`,
    status,
    priority,
    dueDate,
    position: number,
  });
}

const tasks = [
  task(1, "todo", "none", "2026-07-20"),
  task(2, "todo", "urgent", null),
  task(3, "done", "low", null),
  task(4, "done", "high", "2026-07-18"),
];

function renderList() {
  return renderSlot(
    app.navPanels[0]!,
    { subPath: PROJECT_ID },
    {
      rpc: {
        listProjects: () => ({ projects: [project] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listLabels: () => ({ labels: [] }),
        listTasks: () => ({ tasks }),
        listTaskRowMeta: () => ({ rowMeta: [] }),
        listComments: () => ({ comments: [] }),
        listAttachments: () => ({ attachments: [] }),
      },
    },
  );
}

async function rowOrder(slot: ReturnType<typeof renderList>) {
  await waitFor(() =>
    expect(slot.container.querySelectorAll("[data-task-key]").length).toBe(
      tasks.length,
    ),
  );
  const keys = Array.from(
    slot.container.querySelectorAll("[data-task-key]"),
  ).map((row) => row.getAttribute("data-task-key"));
  expect(keys).toHaveLength(tasks.length);
  return keys;
}

async function selectSort(slot: ReturnType<typeof renderList>, label: string) {
  fireEvent.click(slot.getByRole("button", { name: /Sort/ }));
  const drawer = await slot.findByRole("dialog", { name: "Sort tasks" });
  fireEvent.click(
    await within(drawer).findByRole("menuitemcheckbox", { name: label }),
  );
}

describe("list sorting (compact viewport)", () => {
  it("renders manual order, then reorders within status groups", async () => {
    const slot = renderList();
    expect(await rowOrder(slot)).toEqual(["TSK-1", "TSK-2", "TSK-3", "TSK-4"]);

    await selectSort(slot, "Priority");
    await waitFor(async () =>
      expect(await rowOrder(slot)).toEqual([
        "TSK-2",
        "TSK-1",
        "TSK-4",
        "TSK-3",
      ]),
    );

    await selectSort(slot, "Due date");
    await waitFor(async () =>
      expect(await rowOrder(slot)).toEqual([
        "TSK-1",
        "TSK-2",
        "TSK-4",
        "TSK-3",
      ]),
    );
  });

  it("offers every sort mode in the compact drawer and marks the active one", async () => {
    const slot = renderList();
    await waitFor(() =>
      expect(
        slot.container.querySelector('[data-task-key="TSK-1"]'),
      ).not.toBeNull(),
    );

    fireEvent.click(slot.getByRole("button", { name: /Sort/ }));
    const drawer = await slot.findByRole("dialog", { name: "Sort tasks" });
    const options = await within(drawer).findAllByRole("menuitemcheckbox");
    expect(options.map((option) => option.textContent)).toEqual([
      "Manual",
      "Priority",
      "Due date",
    ]);
    expect(
      options.map((option) => option.getAttribute("aria-checked")),
    ).toEqual(["true", "false", "false"]);

    fireEvent.click(
      await within(drawer).findByRole("menuitemcheckbox", {
        name: "Priority",
      }),
    );
    await waitFor(() =>
      expect(slot.getByRole("button", { name: /Sort/ }).textContent).toContain(
        "Priority",
      ),
    );
  });
});

function createDataTransfer() {
  let stored = "";
  return {
    setData: (_format: string, value: string) => {
      stored = value;
    },
    getData: () => stored,
    effectAllowed: "",
  } as unknown as DataTransfer;
}

describe("drag and drop between status sections", () => {
  it("moves a task to the section it's dropped on", async () => {
    const rpcCalls: Record<string, unknown>[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: PROJECT_ID },
      {
        rpc: {
          listProjects: () => ({ projects: [project] }),
          listFolders: () => ({ folders: [] }),
          listPresets: () => ({ presets: [] }),
          sidebarSummary: () => ({ projects: [] }),
          listLabels: () => ({ labels: [] }),
          listTasks: () => ({ tasks }),
          listTaskRowMeta: () => ({ rowMeta: [] }),
          listComments: () => ({ comments: [] }),
          listAttachments: () => ({ attachments: [] }),
          updateTask: (raw: unknown) => {
            const input = raw as { taskId: string; status?: string };
            rpcCalls.push(input);
            const current = tasks.find((entry) => entry.id === input.taskId)!;
            return { ok: true, task: { ...current, ...input } };
          },
        },
      },
    );
    await rowOrder(slot);

    const draggedRow = slot.container.querySelector(
      '[data-task-key="TSK-1"]',
    )!;
    const doneHeader = slot.container.querySelector(
      '[data-status-group-header="done"]',
    )!;
    const doneSection = doneHeader.closest("section")!;

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(draggedRow, { dataTransfer });
    fireEvent.dragOver(doneSection, { dataTransfer });
    fireEvent.drop(doneSection, { dataTransfer });

    await waitFor(() =>
      expect(
        rpcCalls.some(
          (call) =>
            call.taskId === "01HZZZZZZZZZZZZZZZZZZZZZT1" &&
            call.status === "done",
        ),
      ).toBe(true),
    );
  });

  it("does nothing when dropped on the section the task is already in", async () => {
    const rpcCalls: Record<string, unknown>[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: PROJECT_ID },
      {
        rpc: {
          listProjects: () => ({ projects: [project] }),
          listFolders: () => ({ folders: [] }),
          listPresets: () => ({ presets: [] }),
          sidebarSummary: () => ({ projects: [] }),
          listLabels: () => ({ labels: [] }),
          listTasks: () => ({ tasks }),
          listTaskRowMeta: () => ({ rowMeta: [] }),
          listComments: () => ({ comments: [] }),
          listAttachments: () => ({ attachments: [] }),
          updateTask: (raw: unknown) => {
            rpcCalls.push(raw as Record<string, unknown>);
            throw new Error("should not be called");
          },
        },
      },
    );
    await rowOrder(slot);

    const draggedRow = slot.container.querySelector(
      '[data-task-key="TSK-1"]',
    )!;
    const todoHeader = slot.container.querySelector(
      '[data-status-group-header="todo"]',
    )!;
    const todoSection = todoHeader.closest("section")!;

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(draggedRow, { dataTransfer });
    fireEvent.dragOver(todoSection, { dataTransfer });
    fireEvent.drop(todoSection, { dataTransfer });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rpcCalls).toHaveLength(0);
  });
});
