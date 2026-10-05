// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import type {
  Preset,
  Project,
  ProjectThread,
  Task,
  TaskThread,
} from "../../shared/contract.js";
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
  linkedBbProjectId: "proj_launch",
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

function projectThread(projectId: string, suffix: string): ProjectThread {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZJ${suffix}`,
    projectId,
    threadId: `thr_${suffix}`,
    title: `Project worker ${suffix}`,
    attachedAt: "2026-07-15T00:00:00.000Z",
  };
}

const PRESET: Preset = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZE1",
  name: "Sonnet · high",
  providerId: "claude-code",
  modelId: "claude-sonnet-5",
  reasoningLevel: "high",
  serviceTier: null,
  permissionMode: "accept-edits",
  environmentKind: "project-default",
  baseBranch: null,
  machineId: null,
  instructions: "",
  builtin: false,
  createdAt: "2026-07-15T00:00:00.000Z",
};

interface Fixture {
  projects?: Project[];
  tasks?: Task[];
  threadsByTask?: Record<string, TaskThread[]>;
  threadsByProject?: Record<string, ProjectThread[]>;
  presets?: Preset[];
  sidebarThreadIds?: string[];
  sideChats?: { id: string; title: string; sourceThreadId: string }[];
  settings?: Record<string, boolean>;
  threadLinks?: Record<string, { tasks: Task[]; projects: Project[] }>;
  focusedThreadId?: string;
}

function renderList(fixture: Fixture = {}) {
  const projects = fixture.projects ?? [LAUNCH, POLISH, PLANNED];
  const tasks = [...(fixture.tasks ?? [task(1), task(2, "done")])];
  return renderSlot(
    app.navPanels[0]!,
    { subPath: "all" },
    {
      ...(fixture.settings === undefined ? {} : { settings: fixture.settings }),
      ...(fixture.focusedThreadId === undefined
        ? {}
        : {
            sidebarSplitLayout: {
              panes: [
                {
                  paneId: "pane_tasks",
                  rect: { x: 0, y: 0, width: 0.5, height: 1 },
                  threadId: null,
                  isFocused: false,
                },
                {
                  paneId: "pane_thread",
                  rect: { x: 0.5, y: 0, width: 0.5, height: 1 },
                  threadId: fixture.focusedThreadId,
                  isFocused: true,
                },
              ],
            },
          }),
      sidebarThreads: {
        threads: [
          ...(fixture.sidebarThreadIds ?? []).map(makeSidebarThread),
          ...(fixture.sideChats ?? []).map((sideChat) => ({
            ...makeSidebarThread(sideChat.id),
            displayTitle: sideChat.title,
            sourceThreadId: sideChat.sourceThreadId,
            originKind: "fork" as const,
            originPluginId: "side-chat",
            isHidden: true,
          })),
        ],
      },
      rpc: {
        listProjects: () => ({ projects }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: fixture.presets ?? [] }),
        listLabels: () => ({ labels: [] }),
        listProjectThreadsBatch: (raw: unknown) => ({
          projectThreads: (rpcInput(raw).projectIds as string[]).flatMap(
            (projectId) => fixture.threadsByProject?.[projectId] ?? [],
          ),
        }),
        delegateProject: () => ({ threadId: "thr_project_new" }),
        listThreadLinks: (raw: unknown) =>
          fixture.threadLinks?.[rpcInput(raw).threadId as string] ?? {
            tasks: [],
            projects: [],
          },
        searchThreads: () => ({
          threads: [{ id: "thr_free", title: "Refactor pass", status: "idle" }],
        }),
        projectThreadsAttach: () => ({ threadId: "thr_free" }),
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
        listBbProjects: () => ({
          bbProjects: [{ id: "proj_mono", name: "bb monorepo" }],
        }),
        updateProject: (raw: unknown) => {
          const input = rpcInput(raw);
          const current = projects.find((p) => p.id === input.projectId)!;
          return { project: { ...current, ...input } };
        },
        completeProject: (raw: unknown) => {
          const input = rpcInput(raw);
          const current = projects.find((p) => p.id === input.projectId)!;
          return {
            project: { ...current, status: "done" },
            completedTaskIds: tasks
              .filter(
                (entry) =>
                  entry.projectId === current.id && entry.status === "todo",
              )
              .map((entry) => entry.id),
          };
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
          const index = tasks.findIndex((entry) => entry.id === input.taskId);
          const updated = { ...tasks[index]!, ...input };
          tasks[index] = updated;
          return { ok: true, task: updated };
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
    const row = slot.container.querySelector(
      `[data-project-id="${projectId}"]`,
    );
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
  it("groups projects by status with in progress first, in manual order within a section", async () => {
    const slot = renderList();
    await projectRow(slot, LAUNCH.id);
    expect(sectionOrder(slot)).toEqual(["in_progress", "todo"]);
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
      within(row).queryByRole("checkbox", { name: "Mark Task 2 not done" }),
    ).toBeNull();

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

  it("shows done tasks when the Show completed tasks setting is on", async () => {
    const slot = renderList({ settings: { showCompletedTasks: true } });
    const row = await projectRow(slot, LAUNCH.id);
    fireEvent.click(within(row).getByRole("button", { name: "Show tasks" }));
    const done = await within(row).findByRole("checkbox", {
      name: "Mark Task 2 not done",
    });
    expect(done.getAttribute("aria-checked")).toBe("true");
  });

  it("hides a task checked off here only after the project is collapsed", async () => {
    const slot = renderList();
    const row = await projectRow(slot, LAUNCH.id);
    fireEvent.click(within(row).getByRole("button", { name: "Show tasks" }));
    fireEvent.click(
      await within(row).findByRole("checkbox", { name: "Mark Task 1 done" }),
    );
    await within(row).findByRole("checkbox", { name: "Mark Task 1 not done" });

    fireEvent.click(within(row).getByRole("button", { name: "Hide tasks" }));
    fireEvent.click(within(row).getByRole("button", { name: "Show tasks" }));
    await within(row).findByRole("button", { name: "Add task" });
    expect(within(row).queryByRole("checkbox", { name: /Task 1/ })).toBeNull();
  });

  it("highlights the project a focused thread is attached to at the project level", async () => {
    const slot = renderList({
      focusedThreadId: "thr_P1",
      threadLinks: { thr_P1: { tasks: [], projects: [POLISH] } },
      threadsByProject: { [POLISH.id]: [projectThread(POLISH.id, "P1")] },
    });
    const polish = await projectRow(slot, POLISH.id);
    await waitFor(() =>
      expect(polish.hasAttribute("data-active-thread-project")).toBe(true),
    );
    const launch = await projectRow(slot, LAUNCH.id);
    expect(launch.hasAttribute("data-active-thread-project")).toBe(false);

    fireEvent.click(within(polish).getByRole("button", { name: "Show tasks" }));
    const link = await within(polish).findByRole("button", {
      name: "Project worker P1",
    });
    expect(link.hasAttribute("data-active-thread")).toBe(true);
  });

  it("highlights the project and task of a focused task thread", async () => {
    const first = task(1);
    const slot = renderList({
      tasks: [first, task(3)],
      focusedThreadId: "thr_W1",
      threadLinks: { thr_W1: { tasks: [first], projects: [] } },
    });
    const launch = await projectRow(slot, LAUNCH.id);
    await waitFor(() =>
      expect(launch.hasAttribute("data-active-thread-project")).toBe(true),
    );
    fireEvent.click(within(launch).getByRole("button", { name: "Show tasks" }));
    await within(launch).findByRole("checkbox", { name: "Mark Task 3 done" });
    expect(
      launch
        .querySelector(`[data-task-key="${first.key}"]`)
        ?.hasAttribute("data-active-thread-task"),
    ).toBe(true);
    expect(
      launch
        .querySelector('[data-task-key="LCH-3"]')
        ?.hasAttribute("data-active-thread-task"),
    ).toBe(false);
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

  it("lists project-level threads above the tasks and opens one beside the list", async () => {
    const slot = renderList({
      tasks: [task(1)],
      threadsByProject: { [LAUNCH.id]: [projectThread(LAUNCH.id, "P1")] },
      sidebarThreadIds: ["thr_P1"],
    });
    const row = await projectRow(slot, LAUNCH.id);
    fireEvent.click(within(row).getByRole("button", { name: "Show tasks" }));
    const threadButton = await within(row).findByRole("button", {
      name: "Project worker P1",
    });
    const checkbox = await within(row).findByRole("checkbox", {
      name: "Mark Task 1 done",
    });
    expect(
      threadButton.compareDocumentPosition(checkbox) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      slot.rpcCalls.some((call) => call.method === "listProjectThreads"),
    ).toBe(false);

    fireEvent.click(threadButton);
    expect(slot.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "thr_P1",
      options: { split: true },
    });
  });

  it("nests each project thread's side chats under it and opens them in a split", async () => {
    const slot = renderList({
      threadsByProject: {
        [LAUNCH.id]: [
          projectThread(LAUNCH.id, "P1"),
          projectThread(LAUNCH.id, "P2"),
        ],
      },
      sidebarThreadIds: ["thr_P1", "thr_P2"],
      sideChats: [
        { id: "thr_S1", title: "Side question", sourceThreadId: "thr_P1" },
      ],
    });
    const row = await projectRow(slot, LAUNCH.id);
    const projectThreads = row.querySelector(
      `[data-project-threads="${LAUNCH.id}"]`,
    ) as HTMLElement;
    const parent = await within(projectThreads).findByRole("button", {
      name: "Project worker P1",
    });
    const sideChat = within(projectThreads).getByRole("button", {
      name: "Side question",
    });
    const other = within(projectThreads).getByRole("button", {
      name: "Project worker P2",
    });
    expect(parent.parentElement?.contains(sideChat)).toBe(true);
    expect(other.parentElement?.contains(sideChat)).toBe(false);
    fireEvent.click(sideChat);
    expect(slot.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "thr_S1",
      options: { split: true },
    });
  });

  it("shows project threads below the row and icon-only thread actions beside the due date", async () => {
    const slot = renderList({
      threadsByProject: { [LAUNCH.id]: [projectThread(LAUNCH.id, "P1")] },
    });
    const row = await projectRow(slot, LAUNCH.id);
    expect(
      within(row).getByRole("button", { name: "Show tasks" }),
    ).toBeTruthy();
    const projectThreads = row.querySelector(
      `[data-project-threads="${LAUNCH.id}"]`,
    ) as HTMLElement;
    expect(
      await within(projectThreads).findByRole("button", {
        name: "Project worker P1",
      }),
    ).toBeTruthy();
    const actions = row.querySelector(
      `[data-project-thread-actions="${LAUNCH.id}"]`,
    ) as HTMLElement;
    const dueDate = within(row).getByRole("button", { name: /due date/i });
    expect(
      dueDate.compareDocumentPosition(actions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(actions).getByRole("button", { name: "New thread" }).textContent,
    ).toBe("");
    expect(
      within(actions).getByRole("button", { name: "Attach thread" })
        .textContent,
    ).toBe("");
    expect(
      within(actions).queryByRole("button", { name: "Choose thread preset" }),
    ).toBeNull();
    const batches = slot.rpcCalls.filter(
      (call) => call.method === "listProjectThreadsBatch",
    );
    expect(batches).toHaveLength(1);
    expect(rpcInput(batches[0]!.input).projectIds).toContain(LAUNCH.id);
  });

  it("starts a new thread for the whole project from its collapsed row", async () => {
    const slot = renderList({ presets: [PRESET] });
    const row = await projectRow(slot, LAUNCH.id);
    const projectThreads = await waitFor(() => {
      const element = row.querySelector(
        `[data-project-thread-actions="${LAUNCH.id}"]`,
      );
      if (element === null)
        throw new Error("project thread actions not rendered");
      return element as HTMLElement;
    });
    const newThread = within(projectThreads).getByRole("button", {
      name: "New thread",
    });
    await waitFor(() => expect(newThread.hasAttribute("disabled")).toBe(false));
    fireEvent.click(newThread);
    await waitFor(() =>
      expect(
        slot.rpcCalls
          .filter((call) => call.method === "delegateProject")
          .map((call) => rpcInput(call.input)),
      ).toEqual([{ projectId: LAUNCH.id, presetId: PRESET.id }]),
    );
    expect(slot.rpcCalls.some((call) => call.method === "delegate")).toBe(
      false,
    );
  });

  it("asks for a bb project before starting a thread in an unlinked project", async () => {
    const slot = renderList({ presets: [PRESET] });
    const row = await projectRow(slot, POLISH.id);
    const actions = await waitFor(() => {
      const element = row.querySelector(
        `[data-project-thread-actions="${POLISH.id}"]`,
      );
      if (element === null)
        throw new Error("project thread actions not rendered");
      return element as HTMLElement;
    });
    const newThread = within(actions).getByRole("button", {
      name: "New thread",
    });
    await waitFor(() => expect(newThread.hasAttribute("disabled")).toBe(false));
    fireEvent.click(newThread);
    expect(
      slot.rpcCalls.some((call) => call.method === "delegateProject"),
    ).toBe(false);
    fireEvent.click(await slot.findByLabelText("Linked bb project"));
    fireEvent.click(await slot.findByRole("option", { name: "bb monorepo" }));
    fireEvent.click(slot.getByRole("button", { name: "Link and start" }));
    await waitFor(() =>
      expect(
        slot.rpcCalls
          .filter((call) => call.method === "delegateProject")
          .map((call) => rpcInput(call.input)),
      ).toEqual([{ projectId: POLISH.id, presetId: PRESET.id }]),
    );
    expect(
      slot.rpcCalls
        .filter((call) => call.method === "updateProject")
        .map((call) => rpcInput(call.input)),
    ).toEqual([{ projectId: POLISH.id, linkedBbProjectId: "proj_mono" }]);
  });

  it("attaches an existing thread to the project from its collapsed row", async () => {
    const slot = renderList();
    const row = await projectRow(slot, LAUNCH.id);
    const projectThreads = await waitFor(() => {
      const element = row.querySelector(
        `[data-project-thread-actions="${LAUNCH.id}"]`,
      );
      if (element === null)
        throw new Error("project thread actions not rendered");
      return element as HTMLElement;
    });
    fireEvent.click(
      within(projectThreads).getByRole("button", { name: "Attach thread" }),
    );
    fireEvent.click(await slot.findByRole("option", { name: /Refactor pass/ }));
    await waitFor(() =>
      expect(
        slot.rpcCalls
          .filter((call) => call.method === "projectThreadsAttach")
          .map((call) => rpcInput(call.input)),
      ).toEqual([{ projectId: LAUNCH.id, threadId: "thr_free" }]),
    );
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

  it("expands the project from the row instead of opening its page", async () => {
    const slot = renderList();
    const row = await projectRow(slot, LAUNCH.id);
    fireEvent.click(within(row).getByRole("button", { name: "Expand Launch" }));
    expect(
      within(row)
        .getByRole("button", { name: "Collapse Launch" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    within(row).getByRole("button", { name: "Hide tasks" });
    expect(slot.navigateCalls).not.toContainEqual(
      expect.objectContaining({ method: "toPluginPanel" }),
    );
  });

  it("opens the project page from the Details button", async () => {
    const slot = renderList();
    const row = await projectRow(slot, LAUNCH.id);
    fireEvent.click(
      within(row).getByRole("button", { name: "Open Launch details" }),
    );
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

  it("shows a done checkbox on the left and a hover chevron on the right that toggles the tasks", async () => {
    const slot = renderList();
    const row = await projectRow(slot, PLANNED.id);
    const checkbox = within(row).getByRole("checkbox", {
      name: "Mark Planned done",
    });
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    const toggle = within(row).getByRole("button", { name: "Show tasks" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const controls = toggle.parentElement as HTMLElement;
    expect(controls.className).toContain("col-start-3");
    expect(controls.className).toContain("opacity-0");
    expect(controls.className).toContain("group-hover/project:opacity-100");
    fireEvent.click(toggle);
    const hide = within(row).getByRole("button", { name: "Hide tasks" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    expect((hide.parentElement as HTMLElement).className).not.toContain(
      "opacity-0",
    );
    fireEvent.click(hide);
    within(row).getByRole("button", { name: "Show tasks" });
  });

  it("completes a project and its open tasks from the row checkbox", async () => {
    const slot = renderList();
    const row = await projectRow(slot, LAUNCH.id);
    fireEvent.click(
      within(row).getByRole("checkbox", { name: "Mark Launch done" }),
    );
    await waitFor(() =>
      expect(
        slot.rpcCalls
          .filter((call) => call.method === "completeProject")
          .map((call) => rpcInput(call.input)),
      ).toEqual([{ projectId: LAUNCH.id }]),
    );
    expect(
      slot.rpcCalls.filter((call) => call.method === "updateTask"),
    ).toEqual([]);
    await waitFor(() => expect(sectionOrder(slot)).toContain("done"));
    const done = await projectRow(slot, LAUNCH.id);
    expect(
      within(done)
        .getByRole("checkbox", { name: "Mark Launch not done" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("reopens a done project without touching its tasks", async () => {
    const slot = renderList({
      projects: [{ ...PLANNED, status: "done" }],
    });
    const row = await projectRow(slot, PLANNED.id);
    fireEvent.click(
      within(row).getByRole("checkbox", { name: "Mark Planned not done" }),
    );
    await waitFor(() =>
      expect(
        slot.rpcCalls
          .filter((call) => call.method === "updateProject")
          .map((call) => rpcInput(call.input)),
      ).toEqual([{ projectId: PLANNED.id, status: "todo" }]),
    );
    expect(
      slot.rpcCalls.filter((call) => call.method === "completeProject"),
    ).toEqual([]);
  });

  it("changes a project's status from its right-click menu", async () => {
    const slot = renderList();
    const row = await projectRow(slot, PLANNED.id);
    fireEvent.contextMenu(row);
    const statusItem = await slot.findByRole("menuitem", { name: /Status/ });
    fireEvent.keyDown(statusItem, { key: "ArrowRight" });
    fireEvent.click(await slot.findByRole("menuitem", { name: /In Review/ }));
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
      await slot.findByRole("menuitemcheckbox", { name: /In progress/ }),
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
