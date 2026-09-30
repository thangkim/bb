// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { makeProject, makeTask, rpcInput } from "../../test-fixtures.js";

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

installTestPluginRuntime();
const { PropertiesRail } = await import("./rail");
const { TasksRefreshProvider } = await import("../../shell/refresh");

function RailHarness(props: ComponentProps<typeof PropertiesRail>) {
  return (
    <TasksRefreshProvider>
      <PropertiesRail {...props} />
    </TasksRefreshProvider>
  );
}

afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const BB_PROJECT_ID = "proj_bb0000000000000000000001";

function projectRow(linkedBbProjectId: string | null) {
  return makeProject({
    id: PROJECT_ID,
    name: "Tasks Plugin",
    prefix: "TSK",
    nextTaskNumber: 6,
    linkedBbProjectId,
  });
}

const task = makeTask({
  id: "01HZZZZZZZZZZZZZZZZZZZZZT5",
  projectId: PROJECT_ID,
  number: 5,
  key: "TSK-5",
  title: "Ship the rail",
  position: 1,
});

function railProps(linkedBbProjectId: string | null) {
  return {
    task,
    project: projectRow(linkedBbProjectId),
    labels: [],
    threads: [],
    presets: [],
    onUpdate: () => {},
    onError: () => {},
  };
}

describe("task completion rail control", () => {
  it("toggles the task between not done and done", () => {
    const updates: unknown[] = [];
    const slot = renderSlot(
      { component: RailHarness },
      { ...railProps(null), onUpdate: (update: unknown) => updates.push(update) },
      { rpc: { listBbProjects: () => ({ bbProjects: [] }) } },
    );
    const toggle = slot.getByRole("checkbox", { name: "Not done" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(updates).toEqual([{ status: "done" }]);
  });
});

describe("dispatch target rail control", () => {
  it("links a discovered bb project", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot({ component: RailHarness }, railProps(null), {
      rpc: {
        listBbProjects: () => ({
          bbProjects: [{ id: BB_PROJECT_ID, name: "bb monorepo" }],
        }),
        updateProject: (raw: unknown) => {
          const input = rpcInput(raw);
          updateCalls.push(input);
          return {
            project: {
              ...projectRow(input.linkedBbProjectId as string | null),
            },
          };
        },
      },
    });
    fireEvent.click(slot.getByRole("button", { name: "Edit dispatch target" }));
    fireEvent.click(await slot.findByLabelText("Linked bb project"));
    fireEvent.click(await slot.findByRole("option", { name: "bb monorepo" }));
    fireEvent.click(slot.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toEqual({
      projectId: PROJECT_ID,
      linkedBbProjectId: BB_PROJECT_ID,
    });
  });

  it("shows the linked bb project's name and unlinks it", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(
      { component: RailHarness },
      railProps(BB_PROJECT_ID),
      {
        rpc: {
          listBbProjects: () => ({
            bbProjects: [{ id: BB_PROJECT_ID, name: "bb monorepo" }],
          }),
          updateProject: (raw: unknown) => {
            const input = rpcInput(raw);
            updateCalls.push(input);
            return {
              project: {
                ...projectRow(input.linkedBbProjectId as string | null),
              },
            };
          },
        },
      },
    );
    const trigger = slot.getByRole("button", {
      name: "Edit dispatch target",
    });
    await slot.findByText("bb monorepo");

    fireEvent.click(trigger);
    fireEvent.click(await slot.findByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toEqual({
      projectId: PROJECT_ID,
      linkedBbProjectId: null,
    });
  });
});
