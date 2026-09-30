// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import type { Project, Task, TaskThread } from "../../shared/contract.js";
import {
  makeProject,
  makeSidebarThread,
  makeTask,
  rpcInput,
} from "../../test-fixtures.js";

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

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const LAUNCH = makeProject({
  id: "01HZZZZZZZZZZZZZZZZZZZZZP1",
  name: "Launch",
  prefix: "LCH",
  status: "in_progress",
  priority: "high",
  position: 1024,
});
const POLISH = makeProject({
  id: "01HZZZZZZZZZZZZZZZZZZZZZP2",
  name: "Polish",
  prefix: "POL",
  status: "in_progress",
  position: 2048,
});
const PLANNED = makeProject({
  id: "01HZZZZZZZZZZZZZZZZZZZZZP3",
  name: "Planned",
  prefix: "PLN",
  status: "todo",
  position: 1024,
});

function task(number: number, status: Task["status"] = "todo"): Task {
  return makeTask({
    id: `01HZZZZZZZZZZZZZZZZZZZZZT${number}`,
    projectId: LAUNCH.id,
    number,
    key: `LCH-${number}`,
    title: `Task ${number}`,
    status,
    position: number,
  });
}

function thread(taskId: string, suffix: string): TaskThread {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZH${suffix}`,
    taskId,
    threadId: `thr_${suffix}`,
    presetName: "Sonnet · high",
    title: "Worker",
    liveStatus: "working",
    attachedAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };
}

interface Fixture {
  projects?: Project[];
  tasks?: Task[];
  threadsByTask?: Record<string, TaskThread[]>;
  sidebarThreadIds?: string[];
}

function renderList(fixture: Fixture = {}) {
  const projects = fixture.projects ?? [LAUNCH, POLISH, PLANNED];
  const tasks = fixture.tasks ?? [task(1), task(2, "done")];
  return renderSlot(
    app.navPanels[0]!,
    { subPath: "all" },
    {
      sidebarThreads: {
        threads: (fixture.sidebarThreadIds ?? []).map(makeSidebarThread),
      },
      rpc: {
        listProjects: () => ({ projects }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        listLabels: () => ({ labels: [] }),
        sidebarSummary: () => ({
          projects: [
            {
              projectId: LAUNCH.id,
              taskCount: 4,
              doneTaskCount: 1,
              activeAgentCount: 1,
            },
          ],
        }),
        listTasks: (raw: unknown) => ({
          tasks: tasks.filter(
            (entry) => entry.projectId === rpcInput(raw).projectId,
          ),
          nextCursor: null,
        }),
        listTaskRowMeta: (raw: unknown) => ({
          rowMeta: (rpcInput(raw).taskIds as string[]).map((taskId) => ({
            taskId,
            threads: fixture.threadsByTask?.[taskId] ?? [],
          })),
        }),
        updateProject: (raw: unknown) => {
          const input = rpcInput(raw);
          const current = projects.find((p) => p.id === input.projectId)!;
          return { project: { ...current, ...input } };
        },
        moveProject: (raw: unknown) => {
          const input = rpcInput(raw);
          const current = projects.find((p) => p.id === input.projectId)!;
          return { project: { ...current, status: input.status } };
        },
        moveTaskToProject: (raw: unknown) => {
          const input = rpcInput(raw);
          const current = tasks.find((entry) => entry.id === input.taskId)!;
          return {
            ok: true,
            task: { ...current, projectId: input.projectId },
          };
        },
        updateTask: (raw: unknown) => {
          const input = rpcInput(raw);
          const current = tasks.find((entry) => entry.id === input.taskId)!;
          return { ok: true, task: { ...current, ...input } };
        },
      },
    },
  );
}

async function projectRow(
  slot: ReturnType<typeof renderList>,
  projectId: string,
): Promise<HTMLElement> {
  return waitFor(() => {
    const row = slot.container.querySelector(`[data-project-id="${projectId}"]`);
    if (row === null) throw new Error(`row ${projectId} not found`);
    return row as HTMLElement;
  });
}

function fakeDataTransfer() {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    get types() {
      return [...data.keys()];
    },
    effectAllowed: "",
    dropEffect: "",
  };
}

function sectionOrder(slot: ReturnType<typeof renderList>) {
  return Array.from(
    slot.container.querySelectorAll("[data-status-group-header]"),
  ).map((header) => header.getAttribute("data-status-group-header"));
}

describe("projects list", () => {
  it("groups projects by status in workflow order, in manual order within a section", async () => {
    const slot = renderList();
    await projectRow(slot, LAUNCH.id);
    expect(sectionOrder(slot)).toEqual(["todo", "in_progress"]);
    const inProgress = slot.container.querySelector(
      '[data-status-section="in_progress"]',
    ) as HTMLElement;
    expect(
      Array.from(inProgress.querySelectorAll("[data-project-id]")).map((row) =>
        row.getAttribute("data-project-id"),
      ),
    ).toEqual([LAUNCH.id, POLISH.id]);
  });

  it("shows priority and task progress on each row", async () => {
    const slot = renderList();
    const row = await projectRow(slot, LAUNCH.id);
    expect(within(row).getByText("P2")).toBeDefined();
    expect(within(row).getByText("25%")).toBeDefined();
    const bar = within(row).getByTitle("1/4 tasks done · agent working");
    expect(bar.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("collapses and expands a status section from its header", async () => {
    const slot = renderList();
    await projectRow(slot, PLANNED.id);
    const header = slot.container.querySelector(
      '[data-status-group-header="todo"]',
    ) as HTMLElement;
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(
      slot.container.querySelector(`[data-project-id="${PLANNED.id}"]`),
    ).toBeNull();
    fireEvent.click(header);
    await projectRow(slot, PLANNED.id);
  });

  it("expands a project into its task checklist and checks a task off", async () => {
    const slot = renderList();
    const row = await projectRow(slot, LAUNCH.id);
    fireEvent.click(within(row).getByRole("button", { name: "Show tasks" }));
    const open = await within(row).findByRole("checkbox", {
      name: "Mark Task 1 done",
    });
    expect(open.getAttribute("aria-checked")).toBe("false");
    expect(
      within(row)
        .getByRole("checkbox", { name: "Mark Task 2 not done" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(open);
    await waitFor(() =>
      expect(
        slot.rpcCalls.some(
          (call) =>
            call.method === "updateTask" &&
            rpcInput(call.input).status === "done",
        ),
      ).toBe(true),
    );
    await within(row).findByRole("checkbox", { name: "Mark Task 1 not done" });
  });

  it("opens a task's thread in a split pane when the sidebar knows it", async () => {
    const first = task(1);
    const slot = renderList({
      tasks: [first],
      threadsByTask: { [first.id]: [thread(first.id, "W1")] },
      sidebarThreadIds: ["thr_W1"],
    });
    const row = await projectRow(slot, LAUNCH.id);
    fireEvent.click(within(row).getByRole("button", { name: "Show tasks" }));
    fireEvent.click(
      await within(row).findByRole("button", {
        name: "Show attached threads",
      }),
    );
    fireEvent.click(await within(row).findByRole("button", { name: /Worker/ }));
    expect(slot.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "thr_W1",
      options: { split: true },
    });
    expect(slot.navigateCalls).toEqual([]);
  });

  it("navigates to a thread the sidebar does not know", async () => {
    const first = task(1);
    const slot = renderList({
      tasks: [first],
      threadsByTask: { [first.id]: [thread(first.id, "W1")] },
    });
    const row = await projectRow(slot, LAUNCH.id);
    fireEvent.click(within(row).getByRole("button", { name: "Show tasks" }));
    fireEvent.click(
      await within(row).findByRole("button", {
        name: "Show attached threads",
      }),
    );
    fireEvent.click(await within(row).findByRole("button", { name: /Worker/ }));
    expect(slot.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thr_W1",
    });
  });

  it("opens the project page from the row", async () => {
    const slot = renderList();
    const row = await projectRow(slot, LAUNCH.id);
    fireEvent.click(within(row).getByRole("button", { name: "Open Launch" }));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: LAUNCH.id },
    });
  });

  it("moves a dropped project to the end of another status section", async () => {
    const slot = renderList();
    const row = await projectRow(slot, POLISH.id);
    const handle = row.querySelector("[draggable]") as HTMLElement;
    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(handle, { dataTransfer });
    const todo = slot.container.querySelector(
      '[data-status-section="todo"]',
    ) as HTMLElement;
    fireEvent.dragOver(todo, { dataTransfer });
    fireEvent.drop(todo, { dataTransfer });

    await waitFor(() =>
      expect(
        slot.rpcCalls
          .filter((call) => call.method === "moveProject")
          .map((call) => rpcInput(call.input)),
      ).toEqual([
        {
          projectId: POLISH.id,
          status: "todo",
          beforeProjectId: PLANNED.id,
          afterProjectId: null,
        },
      ]),
    );
    const todoAfter = slot.container.querySelector(
      '[data-status-section="todo"]',
    ) as HTMLElement;
    await waitFor(() =>
      expect(
        Array.from(todoAfter.querySelectorAll("[data-project-id]")).map((r) =>
          r.getAttribute("data-project-id"),
        ),
      ).toEqual([PLANNED.id, POLISH.id]),
    );
  });

  it("changes a project's status from its status icon", async () => {
    const slot = renderList();
    const row = await projectRow(slot, PLANNED.id);
    fireEvent.click(
      within(row).getByRole("button", {
        name: /Change status, currently Todo/,
      }),
    );
    const drawer = await slot.findByRole("dialog", { name: "Change status" });
    fireEvent.click(
      await within(drawer).findByRole("menuitem", { name: /In Review/ }),
    );
    await waitFor(() =>
      expect(
        slot.rpcCalls
          .filter((call) => call.method === "updateProject")
          .map((call) => rpcInput(call.input)),
      ).toEqual([{ projectId: PLANNED.id, status: "in_review" }]),
    );
    await waitFor(() => expect(sectionOrder(slot)).toContain("in_review"));
  });

  it("filters by status and remembers the filter", async () => {
    const slot = renderList();
    await projectRow(slot, PLANNED.id);
    fireEvent.click(slot.getByRole("button", { name: /Status/ }));
    fireEvent.click(
      await slot.findByRole("menuitemcheckbox", { name: /In Progress/ }),
    );
    await waitFor(() =>
      expect(
        slot.container.querySelector(`[data-project-id="${PLANNED.id}"]`),
      ).toBeNull(),
    );
    expect(sectionOrder(slot)).toEqual(["in_progress"]);
    cleanup();

    const reopened = renderList();
    await projectRow(reopened, LAUNCH.id);
    expect(
      reopened.container.querySelector(`[data-project-id="${PLANNED.id}"]`),
    ).toBeNull();
  });

  it("moves a task dragged onto another project", async () => {
    const slot = renderList();
    const source = await projectRow(slot, LAUNCH.id);
    fireEvent.click(within(source).getByRole("button", { name: "Show tasks" }));
    const taskRow = (await within(source).findByText("Task 1")).closest(
      "[data-task-key]",
    ) as HTMLElement;
    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(taskRow, { dataTransfer });

    const target = await projectRow(slot, PLANNED.id);
    fireEvent.dragOver(target, { dataTransfer });
    expect(target.getAttribute("data-task-drop-target")).toBe("true");
    fireEvent.drop(target, { dataTransfer });

    await waitFor(() =>
      expect(
        slot.rpcCalls
          .filter((call) => call.method === "moveTaskToProject")
          .map((call) => rpcInput(call.input)),
      ).toEqual([{ taskId: task(1).id, projectId: PLANNED.id }]),
    );
    expect(target.getAttribute("data-task-drop-target")).toBeNull();
    expect(slot.rpcCalls.some((call) => call.method === "moveProject")).toBe(
      false,
    );
  });

  it("ignores a task dropped back on its own project", async () => {
    const slot = renderList();
    const source = await projectRow(slot, LAUNCH.id);
    fireEvent.click(within(source).getByRole("button", { name: "Show tasks" }));
    const taskRow = (await within(source).findByText("Task 1")).closest(
      "[data-task-key]",
    ) as HTMLElement;
    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(taskRow, { dataTransfer });
    fireEvent.drop(source, { dataTransfer });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      slot.rpcCalls.some((call) => call.method === "moveTaskToProject"),
    ).toBe(false);
  });
});
