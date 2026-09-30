// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makeProject, makeTask, rpcInput } from "../test-fixtures.js";
import type { Project, Task } from "../shared/contract.js";

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const app = await loadPluginApp(() => import("../app"));
const { parseTasksRoute, tasksRouteToSubPath } = await import("./routes.js");
const { pagerPosition } = await import("./topbar.js");
const { loadViewMode } = await import("./view-preference.js");
const { querySnapshotStorageKey, resetQuerySnapshotStateForTest } =
  await import("./query-snapshot.js");

const tasksRegistration = app.navPanels[0]!;
const navigationView = tasksRegistration.fixedTabs?.[0]!;
const navigationRegistration = {
  ...tasksRegistration,
  component: navigationView.component,
};

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const FOLDER_ID = "01HZZZZZZZZZZZZZZZZZZZZZF1";

const project = makeProject({
  id: PROJECT_ID,
  name: "Tasks Plugin",
  prefix: "TSK",
  nextTaskNumber: 5,
  folderId: FOLDER_ID,
  status: "in_progress",
});

const folder = {
  id: FOLDER_ID,
  name: "bb",
  parentFolderId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

const summary = {
  projectId: PROJECT_ID,
  taskCount: 3,
  doneTaskCount: 1,
  activeAgentCount: 1,
};

function seededRpc(overrides: Record<string, unknown> = {}) {
  return {
    listProjects: () => ({ projects: [project] }),
    listFolders: () => ({ folders: [folder] }),
    listPresets: () => ({ presets: [] }),
    listLabels: () => ({ labels: [] }),
    sidebarSummary: () => ({ projects: [summary] }),
    listTasks: () => ({ tasks: [], nextCursor: null }),
    listTaskRowMeta: () => ({ rowMeta: [] }),
    getTaskByKey: () => ({ task: null }),
    ...overrides,
  };
}

const emptyRpc = seededRpc({
  listProjects: () => ({ projects: [] }),
  listFolders: () => ({ folders: [] }),
  sidebarSummary: () => ({ projects: [] }),
});

function namedProjects(name: () => string) {
  return () => ({ projects: [{ ...project, name: name() }] });
}

describe("tasks route grammar", () => {
  it("round-trips every route kind and decodes host-encoded subPaths", () => {
    const routes = [
      { kind: "all" },
      { kind: "all", view: "board" },
      { kind: "active" },
      { kind: "active", view: "list" },
      { kind: "manage" },
      { kind: "task", taskKey: "TSK-4" },
      { kind: "project", projectId: PROJECT_ID },
    ] as const;
    for (const route of routes) {
      expect(parseTasksRoute(tasksRouteToSubPath(route))).toEqual(route);
    }
    expect(parseTasksRoute("all%3Fview%3Dboard")).toEqual({
      kind: "all",
      view: "board",
    });
    expect(parseTasksRoute("")).toEqual({ kind: "all" });
    expect(parseTasksRoute("all?view=kanban")).toEqual({ kind: "all" });
    expect(parseTasksRoute(`${PROJECT_ID}?view=board`)).toEqual({
      kind: "project",
      projectId: PROJECT_ID,
    });
  });
});

describe("projects view preference", () => {
  const openAll = (subPath: string) =>
    renderSlot(app.navPanels[0]!, { subPath }, { rpc: seededRpc() });

  it("restores the remembered view when the URL names none", async () => {
    const listed = openAll("all?view=list");
    fireEvent.click(await listed.findByRole("button", { name: "Board" }));
    expect(listed.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: "all?view=board" },
    });
    listed.lifecycle.unmount();
    expect(loadViewMode()).toBe("board");

    const reopened = openAll("all");
    const boardSegment = await reopened.findByRole("button", { name: "Board" });
    expect(boardSegment.getAttribute("aria-pressed")).toBe("true");
    await reopened.findByText("In Review");
  });

  it("navigates from the sidebar to the project page", async () => {
    const slot = renderSlot(
      navigationRegistration,
      { subPath: "all" },
      { rpc: seededRpc() },
    );
    fireEvent.click(await slot.findByText("Tasks Plugin"));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: PROJECT_ID },
    });
  });

  it("still toggles when client storage rejects writes", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is disabled", "SecurityError");
    });
    const slot = openAll("all?view=list");
    fireEvent.click(await slot.findByRole("button", { name: "Board" }));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: "all?view=board" },
    });
  });
});

function pagerTask(key: string, status: Task["status"], position: number) {
  return makeTask({
    id: `01HZZZZZZZZZZZZZZZZZZZZ${key.replace("-", "")}`,
    projectId: PROJECT_ID,
    number: Number(key.split("-")[1]),
    key,
    title: key,
    status,
    position,
  });
}

describe("task pager", () => {
  const tasks = [
    pagerTask("TSK-3", "done", 3),
    pagerTask("TSK-1", "todo", 4),
    pagerTask("TSK-2", "todo", 1),
    pagerTask("TSK-4", "todo", 2),
  ];

  it("orders siblings like the checklist and exposes neighbors", () => {
    expect(pagerPosition(tasks, "TSK-4")).toEqual({
      index: 2,
      total: 4,
      prevKey: "TSK-2",
      nextKey: "TSK-3",
    });
    expect(pagerPosition(tasks, "tsk-2")).toMatchObject({
      index: 1,
      prevKey: null,
    });
    expect(pagerPosition(tasks, "TSK-1")).toMatchObject({
      index: 4,
      nextKey: null,
    });
  });

  it("has no position for unknown keys", () => {
    expect(pagerPosition(tasks, "TSK-99")).toBeNull();
    expect(pagerPosition([], "TSK-1")).toBeNull();
  });

  it("renders n / m on the task route and steps to the next sibling", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/TSK-4" },
      {
        rpc: seededRpc({
          listTasks: () => ({ tasks, nextCursor: null }),
          listAttachments: () => ({ attachments: [] }),
          listTaskThreads: () => ({ taskThreads: [] }),
          listComments: () => ({ comments: [] }),
        }),
      },
    );
    await slot.findByText("2 / 4");
    fireEvent.click(slot.getByRole("button", { name: "Next task" }));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: "task/TSK-3" },
    });
  });
});

describe("tasks app shell", () => {
  it("registers navigation as a BB-owned fixed panel tab", () => {
    expect(tasksRegistration.fixedTabs).toMatchObject([
      {
        id: "navigation",
        title: "Navigation",
        icon: "ListView",
        layout: "flush",
      },
    ]);
  });

  it("does not treat the first connection as a reconnect", async () => {
    let requests = 0;
    let name = "Initial connection name";
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      {
        realtimeConnectionState: "connecting",
        rpc: seededRpc({
          listProjects: () => {
            requests += 1;
            return { projects: [{ ...project, name }] };
          },
        }),
      },
    );
    await slot.findByText("Initial connection name");
    const initialRequests = requests;
    expect(initialRequests).toBeGreaterThan(0);

    await slot.behavior.setRealtimeConnectionState("connected");
    expect(requests).toBe(initialRequests);

    name = "Recovered from connecting state";
    await slot.behavior.setRealtimeConnectionState("connecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    await slot.findByText("Recovered from connecting state");
    expect(requests).toBeGreaterThan(initialRequests);
  });

  it("recovers when the shell mounts during an existing outage", async () => {
    let serverAvailable = false;
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      {
        realtimeConnectionState: "reconnecting",
        rpc: seededRpc({
          listProjects: async () => {
            if (!serverAvailable) throw new Error("server unavailable");
            return {
              projects: [{ ...project, name: "Loaded after existing outage" }],
            };
          },
        }),
      },
    );
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.some((call) => call.method === "listProjects"),
      ).toBe(true),
    );
    expect(slot.queryByText("Loaded after existing outage")).toBeNull();

    serverAvailable = true;
    await slot.behavior.setRealtimeConnectionState("connected");
    await slot.findByText("Loaded after existing outage");
  });

  it("resyncs the project list after reconnect and supports manual refresh", async () => {
    let name = "Stale list name";
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      { rpc: seededRpc({ listProjects: namedProjects(() => name) }) },
    );
    await slot.findByText("Stale list name");

    name = "Recovered list name";
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    expect(slot.queryByText("Recovered list name")).toBeNull();
    await slot.behavior.setRealtimeConnectionState("connected");
    await slot.findByText("Recovered list name");

    name = "Manually refreshed list name";
    fireEvent.click(slot.getByRole("button", { name: "Refresh tasks" }));
    await slot.findByText("Manually refreshed list name");
  });

  it("shares manual refresh across the page and right-panel queries", async () => {
    let pageProjectCalls = 0;
    let panelFolderCalls = 0;
    let holdFolders = false;
    let releaseFolders: (() => void) | undefined;
    const page = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      {
        rpc: seededRpc({
          listProjects: () => {
            pageProjectCalls += 1;
            return { projects: [project] };
          },
        }),
      },
    );
    const panel = renderSlot(
      navigationRegistration,
      { subPath: "all" },
      {
        rpc: seededRpc({
          listFolders: async () => {
            panelFolderCalls += 1;
            if (holdFolders) {
              await new Promise<void>((resolve) => {
                releaseFolders = resolve;
              });
            }
            return { folders: [folder] };
          },
        }),
      },
    );
    await page.findByRole("button", { name: "Refresh tasks" });
    await panel.findByText("Tasks Plugin");
    const initialPageCalls = pageProjectCalls;
    const initialPanelCalls = panelFolderCalls;

    holdFolders = true;
    const refresh = page.getByRole("button", {
      name: "Refresh tasks",
    }) as HTMLButtonElement;
    fireEvent.click(refresh);

    await waitFor(() =>
      expect(pageProjectCalls).toBeGreaterThan(initialPageCalls),
    );
    await waitFor(() =>
      expect(panelFolderCalls).toBeGreaterThan(initialPanelCalls),
    );
    expect(refresh.disabled).toBe(true);
    const callsWhilePanelPending = pageProjectCalls;
    fireEvent.click(refresh);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pageProjectCalls).toBe(callsWhilePanelPending);

    releaseFolders?.();
    await waitFor(() => expect(refresh.disabled).toBe(false));
  });

  it("exposes a subtle icon-only refresh control left of New project", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      { rpc: seededRpc() },
    );
    await slot.findByText("Tasks Plugin");

    const refresh = slot.getByRole("button", { name: "Refresh tasks" });
    const newProject = slot.getByRole("button", { name: "New project" });

    expect(refresh.textContent?.trim() ?? "").not.toMatch(/Refresh/i);
    expect(refresh.className).toMatch(/size-7/);
    expect(
      refresh.compareDocumentPosition(newProject) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("single-flights manual refresh against deferred RPCs", async () => {
    let calls = 0;
    let name = "Flight name A";
    let hold = false;
    const pendingResolvers: Array<() => void> = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      {
        rpc: seededRpc({
          listProjects: () => {
            calls += 1;
            const response = { projects: [{ ...project, name }] };
            if (!hold) return response;
            return new Promise((resolve) => {
              pendingResolvers.push(() => resolve(response));
            });
          },
        }),
      },
    );
    await slot.findByText("Flight name A");
    const baseline = calls;
    const refresh = slot.getByRole("button", {
      name: "Refresh tasks",
    }) as HTMLButtonElement;

    hold = true;
    name = "Flight name B";
    fireEvent.click(refresh);
    await waitFor(() => expect(calls).toBeGreaterThan(baseline));
    expect(refresh.disabled).toBe(true);
    expect(refresh.getAttribute("aria-busy")).toBe("true");

    const callsWhilePending = calls;
    fireEvent.click(refresh);
    fireEvent.click(refresh);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(callsWhilePending);

    for (const resolve of pendingResolvers.splice(0)) resolve();
    await slot.findByText("Flight name B");
    await waitFor(() => expect(refresh.disabled).toBe(false));
  });

  it("retains stale list data when a manual refresh fails, then recovers", async () => {
    let shouldFail = false;
    let name = "Stable name";
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      {
        rpc: seededRpc({
          listProjects: () => {
            if (shouldFail) throw new Error("refresh failed");
            return { projects: [{ ...project, name }] };
          },
        }),
      },
    );
    await slot.findByText("Stable name");

    shouldFail = true;
    fireEvent.click(slot.getByRole("button", { name: "Refresh tasks" }));
    await waitFor(() => {
      expect(
        (
          slot.getByRole("button", {
            name: "Refresh tasks",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });
    expect(slot.getByText("Stable name")).toBeDefined();

    shouldFail = false;
    name = "Recovered after failure";
    fireEvent.click(slot.getByRole("button", { name: "Refresh tasks" }));
    await slot.findByText("Recovered after failure");
  });

  it("resyncs an open task detail after reconnect", async () => {
    let title = "Stale detail title";
    const task = pagerTask("TSK-4", "todo", 1);
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/TSK-4" },
      {
        rpc: seededRpc({
          getTaskByKey: () => ({ task: { ...task, title } }),
          listTasks: () => ({ tasks: [{ ...task, title }], nextCursor: null }),
          listAttachments: () => ({ attachments: [] }),
          listTaskThreads: () => ({ taskThreads: [] }),
          listComments: () => ({ comments: [] }),
        }),
      },
    );
    await slot.findByRole("textbox", { name: "Task title" });
    expect(slot.getByRole("textbox", { name: "Task title" }).textContent).toBe(
      "Stale detail title",
    );

    title = "Recovered detail title";
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    await waitFor(() =>
      expect(
        slot.getByRole("textbox", { name: "Task title" }).textContent,
      ).toBe("Recovered detail title"),
    );
  });

  describe("last-known snapshot", () => {
    const projectsKey = querySnapshotStorageKey("projects");
    const foldersKey = querySnapshotStorageKey("folders");
    const summaryKey = querySnapshotStorageKey("sidebar-summary");
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    }

    it("never paints the empty state while projects are unknown", async () => {
      const projects = deferred<{ projects: never[] }>();
      const slot = renderSlot(
        app.navPanels[0]!,
        { subPath: "" },
        {
          rpc: seededRpc({
            listProjects: () => projects.promise,
            sidebarSummary: () => ({ projects: [] }),
          }),
        },
      );
      expect(slot.queryByText("No projects yet")).toBeNull();
      projects.resolve({ projects: [] });
      await slot.findByText("No projects yet");
    });

    it("paints the last-known empty state before listProjects resolves", () => {
      window.localStorage.setItem(projectsKey, JSON.stringify([]));
      window.localStorage.setItem(foldersKey, JSON.stringify([]));
      window.localStorage.setItem(summaryKey, JSON.stringify([]));
      const projects = deferred<{ projects: never[] }>();
      const slot = renderSlot(
        app.navPanels[0]!,
        { subPath: "" },
        {
          rpc: seededRpc({
            listProjects: () => projects.promise,
            sidebarSummary: () => ({ projects: [] }),
          }),
        },
      );
      expect(slot.getByText("No projects yet")).toBeTruthy();
    });

    it("paints last-known projects before listProjects resolves and never flashes empty", async () => {
      window.localStorage.setItem(projectsKey, JSON.stringify([project]));
      window.localStorage.setItem(foldersKey, JSON.stringify([folder]));
      window.localStorage.setItem(summaryKey, JSON.stringify([summary]));
      const projects = deferred<{ projects: Project[] }>();
      const rpc = seededRpc({ listProjects: () => projects.promise });
      const panel = renderSlot(
        navigationRegistration,
        { subPath: "" },
        { rpc },
      );
      const page = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc });
      expect(within(panel.container).getByText(project.name)).toBeTruthy();
      expect(within(page.container).getByText(project.name)).toBeTruthy();
      expect(page.queryByText("No projects yet")).toBeNull();
      projects.resolve({ projects: [project] });
      await waitFor(() =>
        expect(within(panel.container).getByText(project.name)).toBeTruthy(),
      );
      expect(page.queryByText("No projects yet")).toBeNull();
    });

    it("ignores a malformed snapshot and loads normally", async () => {
      window.localStorage.setItem(projectsKey, "{not json");
      window.localStorage.setItem(
        summaryKey,
        JSON.stringify([{ projectId: 1 }]),
      );
      const slot = renderSlot(
        app.navPanels[0]!,
        { subPath: "" },
        { rpc: emptyRpc },
      );
      expect(slot.queryByText("No projects yet")).toBeNull();
      await slot.findByText("No projects yet");
    });

    it("prunes snapshots written under an older storage version", async () => {
      resetQuerySnapshotStateForTest();
      window.localStorage.setItem(
        "bb-tasks:query-snapshot:v0:projects",
        JSON.stringify([]),
      );
      const slot = renderSlot(
        navigationRegistration,
        { subPath: "" },
        { rpc: seededRpc() },
      );
      await slot.findByText(project.name);
      expect(
        window.localStorage.getItem("bb-tasks:query-snapshot:v0:projects"),
      ).toBeNull();
      expect(window.localStorage.getItem(projectsKey)).not.toBeNull();
    });

    it("records the fetched projects and counts for the next mount", async () => {
      const slot = renderSlot(
        navigationRegistration,
        { subPath: "" },
        { rpc: seededRpc() },
      );
      await slot.findByText(project.name);
      await waitFor(() => {
        expect(
          JSON.parse(window.localStorage.getItem(projectsKey) ?? "null"),
        ).toEqual([project]);
        expect(
          JSON.parse(window.localStorage.getItem(foldersKey) ?? "null"),
        ).toEqual([folder]);
        expect(
          JSON.parse(window.localStorage.getItem(summaryKey) ?? "null"),
        ).toEqual([summary]);
      });
    });

    it("keeps the newer projects snapshot when an older request resolves later", async () => {
      const olderProject = { ...project, name: "Older truth" };
      const newerProject = { ...project, name: "Newer truth" };
      const older = deferred<{ projects: Project[] }>();
      let calls = 0;
      const rpc = seededRpc({
        listProjects: () => {
          calls += 1;
          return calls === 1 ? older.promise : { projects: [newerProject] };
        },
      });
      renderSlot(navigationRegistration, { subPath: "" }, { rpc });
      const second = renderSlot(
        navigationRegistration,
        { subPath: "" },
        { rpc },
      );
      await second.findByText("Newer truth");
      await waitFor(() =>
        expect(
          JSON.parse(window.localStorage.getItem(projectsKey) ?? "null"),
        ).toEqual([newerProject]),
      );
      older.resolve({ projects: [olderProject] });
      await act(async () => {
        await older.promise;
      });
      expect(
        JSON.parse(window.localStorage.getItem(projectsKey) ?? "null"),
      ).toEqual([newerProject]);
    });

    it.each(["listFolders", "sidebarSummary"])(
      "keeps loaded projects navigable when %s fails",
      async (method) => {
        const slot = renderSlot(
          navigationRegistration,
          { subPath: "all" },
          {
            rpc: seededRpc({
              [method]: () => Promise.reject(new Error("boom")),
            }),
          },
        );
        fireEvent.click(await slot.findByText(project.name));
        expect(slot.navigateCalls).toContainEqual({
          method: "toPluginPanel",
          path: "tasks",
          options: { subPath: PROJECT_ID },
        });
      },
    );
  });

  it("shows only projects with live agents on the Active page", async () => {
    const idle = makeProject({
      id: "01HZZZZZZZZZZZZZZZZZZZZZP2",
      name: "Idle project",
      prefix: "IDL",
    });
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "active" },
      {
        rpc: seededRpc({
          listProjects: () => ({ projects: [project, idle] }),
        }),
      },
    );
    await slot.findByText("Tasks Plugin");
    expect(slot.queryByText("Idle project")).toBeNull();
  });

  it("explains an empty Active page", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "active" },
      {
        rpc: seededRpc({
          sidebarSummary: () => ({
            projects: [{ ...summary, activeAgentCount: 0 }],
          }),
        }),
      },
    );
    await slot.findByText("No agents working right now");
  });

  it("shows the empty state and opens the New project dialog", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      { rpc: emptyRpc },
    );
    await slot.findByText("No projects yet");
    fireEvent.click(slot.getAllByRole("button", { name: /New project/ })[0]!);
    await slot.findByText("Projects group tasks under a shared key prefix.");
  });

  it("renders the project board and task subPaths without plugin-owned sidebar chrome", async () => {
    const boardSlot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all?view=board" },
      { rpc: seededRpc() },
    );
    await boardSlot.findByText("Backlog");
    await boardSlot.findByText("In Review");
    const column = boardSlot.container.querySelector(
      '[data-board-column="in_progress"]',
    ) as HTMLElement;
    await waitFor(() =>
      expect(within(column).getByText("Tasks Plugin")).toBeDefined(),
    );
    expect(within(column).getByText("1/3")).toBeDefined();
    expect(boardSlot.queryByRole("button", { name: /sidebar/i })).toBeNull();
    cleanup();

    const taskSlot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/TSK-4" },
      { rpc: seededRpc() },
    );
    await taskSlot.findByText(/Task TSK-4 was not found/);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(taskSlot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: "all" },
    });
  });

  it("opens the project page with its tasks and progress", async () => {
    const updates: Record<string, unknown>[] = [];
    const tasks = [
      pagerTask("TSK-1", "done", 1),
      pagerTask("TSK-2", "todo", 2),
    ];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: PROJECT_ID },
      {
        rpc: seededRpc({
          listTasks: () => ({ tasks, nextCursor: null }),
          listBbProjects: () => ({ bbProjects: [] }),
          updateTask: (raw: unknown) => {
            const input = rpcInput(raw);
            updates.push(input);
            const current = tasks.find((task) => task.id === input.taskId)!;
            return { ok: true, task: { ...current, ...input } };
          },
        }),
      },
    );
    const title = await slot.findByRole("textbox", { name: "Project name" });
    expect(title.textContent).toBe("Tasks Plugin");
    await slot.findByText("TSK-2");
    expect(slot.getAllByText("1/3").length).toBeGreaterThan(0);

    fireEvent.click(
      slot.getByRole("checkbox", { name: "Mark TSK-2 done" }),
    );
    await waitFor(() =>
      expect(updates).toContainEqual(
        expect.objectContaining({ taskId: tasks[1]!.id, status: "done" }),
      ),
    );
  });

  it("links the project page and task page back through a breadcrumb", async () => {
    const projectSlot = renderSlot(
      app.navPanels[0]!,
      { subPath: PROJECT_ID },
      { rpc: seededRpc({ listBbProjects: () => ({ bbProjects: [] }) }) },
    );
    const projectCrumbs = await projectSlot.findByRole("navigation", {
      name: "Breadcrumb",
    });
    await within(projectCrumbs).findByText("Tasks Plugin");
    fireEvent.click(
      within(projectCrumbs).getByRole("button", { name: "All projects" }),
    );
    expect(projectSlot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: "all" },
    });
    cleanup();

    const taskSlot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/TSK-4" },
      { rpc: seededRpc() },
    );
    const taskCrumbs = await taskSlot.findByRole("navigation", {
      name: "Breadcrumb",
    });
    fireEvent.click(
      await within(taskCrumbs).findByRole("button", { name: "Tasks Plugin" }),
    );
    expect(taskSlot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: PROJECT_ID },
    });
  });

  it("renders right-panel navigation and routes through the plugin panel", async () => {
    const slot = renderSlot(
      navigationRegistration,
      { subPath: "all" },
      { rpc: seededRpc() },
    );
    await slot.findByText("Tasks Plugin");
    expect(slot.getByRole("button", { name: /^All projects/ })).toBeDefined();
    expect(slot.getByRole("button", { name: "Manage" })).toBeDefined();

    fireEvent.click(slot.getByTitle("Tasks Plugin"));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: PROJECT_ID },
    });
  });

  it("does not mount New project queries until the dialog opens", async () => {
    let bbProjectCalls = 0;
    const slot = renderSlot(
      navigationRegistration,
      { subPath: "all" },
      {
        rpc: seededRpc({
          listBbProjects: () => {
            bbProjectCalls += 1;
            return { bbProjects: [] };
          },
        }),
      },
    );
    await slot.findByRole("button", { name: "New project" });
    expect(bbProjectCalls).toBe(0);

    fireEvent.click(slot.getByRole("button", { name: "New project" }));

    await slot.findByText("Projects group tasks under a shared key prefix.");
    expect(bbProjectCalls).toBeGreaterThan(0);
  });

  it("routes 'manage' to the manage panel from right-panel navigation", async () => {
    const panel = renderSlot(
      navigationRegistration,
      { subPath: "all" },
      { rpc: seededRpc() },
    );
    await panel.findByRole("button", { name: "Manage" });
    fireEvent.click(panel.getByRole("button", { name: "Manage" }));
    expect(panel.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: "manage" },
    });
    cleanup();

    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "manage" },
      { rpc: seededRpc() },
    );
    await slot.findByText("Labels, agent presets, and folders.");
  });

  it("opens quick-create on bare 'c' but not from editable targets or dialogs", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      { rpc: seededRpc() },
    );
    await slot.findByText("All projects");
    fireEvent.keyDown(window, { key: "c" });
    await slot.findByRole("dialog");
    fireEvent.keyDown(window, { key: "c" });
    expect(slot.getAllByRole("dialog")).toHaveLength(1);
  });

  it("marks only new-worktree presets with the worktree hint", async () => {
    const basePreset = {
      id: "01HZZZZZZZZZZZZZZZZZZZZZE1",
      name: "Default env",
      providerId: "claude-code",
      modelId: "claude-sonnet-5",
      reasoningLevel: "medium",
      serviceTier: null,
      permissionMode: "accept-edits",
      environmentKind: "project-default",
      baseBranch: null,
      machineId: null,
      instructions: "",
      builtin: false,
      createdAt: "2026-07-15T00:00:00.000Z",
    };
    const slot = renderSlot(
      navigationRegistration,
      { subPath: "all" },
      {
        rpc: seededRpc({
          listPresets: () => ({
            presets: [
              basePreset,
              {
                ...basePreset,
                id: "01HZZZZZZZZZZZZZZZZZZZZZE2",
                name: "Worktree env",
                environmentKind: "new-worktree",
                baseBranch: "main",
              },
            ],
          }),
        }),
      },
    );
    await slot.findByText("Worktree env");
    expect(slot.getByText("Default env")).toBeDefined();
    expect(slot.getAllByLabelText("Spawns a new worktree")).toHaveLength(1);
  });

  it("refetches sidebar data when invalidation channels fire", async () => {
    let projectCalls = 0;
    const slot = renderSlot(
      navigationRegistration,
      { subPath: "all" },
      {
        rpc: seededRpc({
          listProjects: () => {
            projectCalls += 1;
            return { projects: [project] };
          },
        }),
      },
    );
    await slot.findByText("Tasks Plugin");
    const before = projectCalls;
    await slot.emitRealtime("projects:changed", { projectId: null });
    await waitFor(() => expect(projectCalls).toBeGreaterThan(before));
    const settled = projectCalls;
    await slot.emitRealtime("comments:changed", { taskId: "x" });
    expect(projectCalls).toBe(settled);
  });
});
