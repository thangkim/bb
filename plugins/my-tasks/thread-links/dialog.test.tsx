// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  useBbNavigate,
  useSdk,
  type PluginThreadActionItemInput,
} from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makeProject, makeTask, rpcInput } from "../test-fixtures.js";
import { closeThreadLinks } from "./store.js";

window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  act(() => closeThreadLinks());
  cleanup();
});

const THREAD_ID = "thr_menu";
const BB_PROJECT_ID = "proj_bb";

const linkedProject = makeProject({
  id: "01HZZZZZZZZZZZZZZZZZZZZZP1",
  name: "Launch",
  prefix: "LCH",
  linkedBbProjectId: BB_PROJECT_ID,
});
const otherProject = makeProject({
  id: "01HZZZZZZZZZZZZZZZZZZZZZP2",
  name: "Research",
  prefix: "RES",
});
const suggestedTask = makeTask({
  id: "01HZZZZZZZZZZZZZZZZZZZZZT1",
  projectId: linkedProject.id,
  key: "LCH-1",
  title: "Write the launch post",
});
const attachedTask = makeTask({
  id: "01HZZZZZZZZZZZZZZZZZZZZZT2",
  projectId: otherProject.id,
  key: "RES-3",
  title: "Interview users",
});

function renderOverlay(links: {
  tasks: (typeof attachedTask)[];
  projects: (typeof otherProject)[];
}) {
  const overlay = app.appOverlays.find((entry) => entry.id === "thread-links");
  const action = app.threadActions.find((entry) => entry.id === "attach");
  expect(overlay).toBeDefined();
  expect(action).toMatchObject({ title: "Attach to My Tasks…" });
  const Overlay = overlay!.component;
  let context: Pick<
    PluginThreadActionItemInput<unknown>,
    "sdk" | "navigate"
  > | null = null;
  function Harness() {
    context = { sdk: useSdk(), navigate: useBbNavigate() };
    return <Overlay />;
  }
  const slot = renderSlot(
    { component: Harness },
    {},
    {
      rpc: {
        listProjects: () => ({ projects: [linkedProject, otherProject] }),
        listThreadLinks: () => links,
        listTasks: (input: unknown) => {
          const { projectId, search } = rpcInput(input);
          return {
            tasks:
              projectId === linkedProject.id || search === "launch"
                ? [suggestedTask]
                : [],
            nextCursor: null,
          };
        },
        taskThreadsAttach: () => ({ threadId: THREAD_ID }),
        taskThreadsDetach: () => ({ threadId: THREAD_ID }),
        projectThreadsAttach: () => ({ threadId: THREAD_ID }),
      },
    },
  );
  const item = action!.item({
    ...context!,
    data: undefined,
    thread: {
      id: THREAD_ID,
      projectId: BB_PROJECT_ID,
      parentThreadId: null,
      archivedAt: null,
      pinnedAt: null,
      sectionId: null,
      isUnread: false,
      status: "idle",
      environment: null,
    },
  });
  act(() => {
    void item!.run({ requestRename: () => {} });
  });
  return slot;
}

async function findOption(text: string): Promise<HTMLElement> {
  const label = await screen.findByText(text);
  const option = label.closest<HTMLElement>('[role="option"]');
  expect(option).not.toBeNull();
  return option!;
}

function queryOption(text: string): HTMLElement | null {
  return screen.queryByText(text)?.closest<HTMLElement>('[role="option"]') ?? null;
}

describe("Attach to My Tasks dialog", () => {
  it("stays closed until the thread menu action runs", () => {
    const overlay = app.appOverlays.find((entry) => entry.id === "thread-links");
    renderSlot({ component: overlay!.component }, {}, { rpc: {} });
    expect(screen.queryByText("Attach to My Tasks")).toBeNull();
  });

  it("suggests open tasks from projects linked to the thread's bb project and attaches one", async () => {
    const slot = renderOverlay({ tasks: [], projects: [] });

    const option = await findOption("Write the launch post");
    expect(
      slot.inspection.rpcCalls.find((call) => call.method === "listTasks")
        ?.input,
    ).toMatchObject({ projectId: linkedProject.id, statuses: ["todo"] });

    fireEvent.click(option);

    await waitFor(() =>
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "taskThreadsAttach",
        input: { taskId: suggestedTask.id, threadId: THREAD_ID },
      }),
    );
  });

  it("detaches an attached task and attaches a whole project", async () => {
    const slot = renderOverlay({ tasks: [attachedTask], projects: [] });

    fireEvent.click(
      await findOption("Interview users"),
    );
    await waitFor(() =>
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "taskThreadsDetach",
        input: { taskId: attachedTask.id, threadId: THREAD_ID },
      }),
    );

    fireEvent.click(await findOption("LCH"));
    await waitFor(() =>
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "projectThreadsAttach",
        input: { projectId: linkedProject.id, threadId: THREAD_ID },
      }),
    );
  });

  it("searches tasks by text and filters projects by name or prefix", async () => {
    renderOverlay({ tasks: [], projects: [] });

    fireEvent.change(
      await screen.findByPlaceholderText("Search projects and tasks…"),
      { target: { value: "launch" } },
    );

    expect(
      await findOption("Write the launch post"),
    ).toBeDefined();
    await waitFor(() =>
      expect(queryOption("RES")).toBeNull(),
    );
    expect(await findOption("LCH")).toBeDefined();
  });
});
