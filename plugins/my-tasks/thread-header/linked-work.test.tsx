// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makeProject, makeTask } from "../test-fixtures.js";
import {
  closeThreadLinks,
  getThreadLinksTarget,
} from "../thread-links/store.js";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  closeThreadLinks();
});

const project = makeProject({
  id: "01HZZZZZZZZZZZZZZZZZZZZZP1",
  name: "Launch",
  prefix: "LCH",
});
const otherProject = makeProject({
  id: "01HZZZZZZZZZZZZZZZZZZZZZP2",
  name: "Research",
  prefix: "RES",
});
const task = makeTask({
  id: "01HZZZZZZZZZZZZZZZZZZZZZT1",
  projectId: project.id,
  key: "LCH-1",
  title: "Write the launch post",
});
const otherTask = makeTask({
  id: "01HZZZZZZZZZZZZZZZZZZZZZT2",
  projectId: project.id,
  key: "LCH-2",
  title: "Record the demo",
});

function renderHeader(
  links: { tasks: (typeof task)[]; projects: (typeof project)[] },
  options: { isCompactViewport?: boolean; openThreadPanel?: () => boolean } = {},
) {
  const slot = app.threadHeaderActions.find(
    (entry) => entry.id === "linked-work",
  );
  expect(slot).toBeDefined();
  return renderSlot(
    slot!,
    {
      threadId: "thr_header",
      projectId: "proj_bb",
      isCompactViewport: options.isCompactViewport ?? false,
    },
    {
      ...(options.openThreadPanel
        ? { openThreadPanel: options.openThreadPanel }
        : {}),
      rpc: { listThreadLinks: () => links },
    },
  );
}

describe("thread header linked work", () => {
  it("renders after the thread title", () => {
    const slot = app.threadHeaderActions.find(
      (entry) => entry.id === "linked-work",
    );
    expect(slot?.placement).toBe("title");
  });

  it("shows the attached task over the project and opens the picker to change it", async () => {
    const openThreadPanel = vi.fn(() => true);
    const slot = renderHeader(
      { tasks: [task, otherTask], projects: [otherProject] },
      { openThreadPanel },
    );

    const button = await slot.findByRole("button", {
      name: "Task LCH-1: Write the launch post (1 more)",
    });
    expect(button.textContent).toBe("Write the launch post+1");
    expect(button.querySelector("[data-icon]")).toBeNull();
    expect(button.dataset).toMatchObject({
      linkedWorkKind: "task",
      linkedWorkLabel: "Write the launch post",
    });
    expect(button.dataset.linkedWorkColor).toBeUndefined();
    expect(slot.queryByText("Research")).toBeNull();

    fireEvent.click(button);
    expect(getThreadLinksTarget()).toMatchObject({
      threadId: "thr_header",
      projectId: "proj_bb",
    });
    expect(openThreadPanel).not.toHaveBeenCalled();
  });

  it("shows the project name when only a project is attached and opens the picker to change it", async () => {
    const slot = renderHeader({ tasks: [], projects: [otherProject] });

    const button = await slot.findByRole("button", {
      name: "Project Research",
    });
    expect(button.textContent).toBe("Research");
    expect(button.dataset).toMatchObject({
      linkedWorkKind: "project",
      linkedWorkLabel: "Research",
      linkedWorkColor: otherProject.color,
    });

    fireEvent.click(button);
    expect(getThreadLinksTarget()).toMatchObject({
      threadId: "thr_header",
      projectId: "proj_bb",
    });
    expect(slot.navigateCalls).toEqual([]);
  });

  it("renders nothing when the thread is not attached", async () => {
    const slot = renderHeader({ tasks: [], projects: [] });
    await waitFor(() =>
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "listThreadLinks",
        input: { threadId: "thr_header" },
      }),
    );
    expect(slot.queryByRole("button")).toBeNull();
  });

  it("appears when a task is attached and updates when it is detached", async () => {
    let links: { tasks: (typeof task)[]; projects: (typeof project)[] } = {
      tasks: [],
      projects: [],
    };
    const slot = renderSlot(
      app.threadHeaderActions.find((entry) => entry.id === "linked-work")!,
      { threadId: "thr_header", projectId: "proj_bb", isCompactViewport: false },
      { rpc: { listThreadLinks: () => links } },
    );
    await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(1));
    expect(slot.queryByRole("button")).toBeNull();

    links = { tasks: [task], projects: [project] };
    await slot.emitRealtime("tasks:changed", {
      taskId: task.id,
      projectId: project.id,
    });
    await slot.findByRole("button", {
      name: "Task LCH-1: Write the launch post",
    });

    links = { tasks: [], projects: [project] };
    await slot.emitRealtime("tasks:changed", {
      taskId: task.id,
      projectId: project.id,
    });
    await slot.findByRole("button", { name: "Project Launch" });
  });

  it("never shows the previous thread's work after the pane switches threads", async () => {
    const slotEntry = app.threadHeaderActions.find(
      (entry) => entry.id === "linked-work",
    )!;
    let resolveSecond: (value: {
      tasks: (typeof task)[];
      projects: (typeof project)[];
    }) => void = () => {};
    const slot = renderSlot(
      slotEntry,
      { threadId: "thr_first", projectId: "proj_bb", isCompactViewport: false },
      {
        rpc: {
          listThreadLinks: (input: unknown) =>
            JSON.stringify(input) === JSON.stringify({ threadId: "thr_first" })
              ? { tasks: [task], projects: [] }
              : new Promise((resolve) => {
                  resolveSecond = resolve;
                }),
        },
      },
    );
    await slot.findByRole("button", {
      name: "Task LCH-1: Write the launch post",
    });

    const Component = slotEntry.component;
    slot.lifecycle.rerender(
      <Component
        threadId="thr_second"
        projectId="proj_bb"
        isCompactViewport={false}
      />,
    );
    await waitFor(() =>
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "listThreadLinks",
        input: { threadId: "thr_second" },
      }),
    );
    expect(slot.queryByRole("button")).toBeNull();

    resolveSecond({ tasks: [], projects: [otherProject] });
    await slot.findByRole("button", { name: "Project Research" });
  });

  it("collapses to an icon on compact viewports", async () => {
    const slot = renderHeader(
      { tasks: [task], projects: [] },
      { isCompactViewport: true },
    );
    const button = await slot.findByRole("button", {
      name: "Task LCH-1: Write the launch post",
    });
    expect(button.textContent).toBe("");
    expect(button.querySelector('[data-icon="ListTodo"]')).not.toBeNull();
  });
});
