// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import { rpcInput } from "../../test-fixtures.js";

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

installTestPluginRuntime();
const { AttachThreadPicker, NewThreadMenu } = await import(
  "./thread-actions.js"
);

afterEach(cleanup);

const TASK_ID = "01HZZZZZZZZZZZZZZZZZZZZZT1";

const preset = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZE1",
  name: "Sonnet · high",
  providerId: "claude-code",
  modelId: "claude-sonnet-5",
  reasoningLevel: "high" as const,
  serviceTier: null,
  permissionMode: "accept-edits" as const,
  environmentKind: "project-default" as const,
  baseBranch: null,
  machineId: null,
  instructions: "",
  builtin: false,
  createdAt: "2026-07-15T00:00:00.000Z",
};

describe("new thread menu", () => {
  it("dispatches a new thread for the task with the chosen preset", async () => {
    const errors: string[] = [];
    const slot = renderSlot(
      { component: NewThreadMenu },
      {
        taskId: TASK_ID,
        presets: [preset],
        onError: (message: string) => errors.push(message),
      },
      { rpc: { delegate: () => ({ threadId: "thr_new" }) } },
    );
    fireEvent.click(slot.getByRole("button", { name: "New thread" }));
    fireEvent.click(
      await slot.findByRole("menuitem", { name: /Sonnet · high/ }),
    );
    await waitFor(() =>
      expect(
        slot.rpcCalls
          .filter((call) => call.method === "delegate")
          .map((call) => rpcInput(call.input)),
      ).toEqual([{ taskId: TASK_ID, presetId: preset.id }]),
    );
    expect(errors).toEqual([]);
  });

  it("reports a failed dispatch", async () => {
    const errors: string[] = [];
    const slot = renderSlot(
      { component: NewThreadMenu },
      {
        taskId: TASK_ID,
        presets: [preset],
        onError: (message: string) => errors.push(message),
      },
      {
        rpc: {
          delegate: () => {
            throw new Error("project is not linked");
          },
        },
      },
    );
    fireEvent.click(slot.getByRole("button", { name: "New thread" }));
    fireEvent.click(
      await slot.findByRole("menuitem", { name: /Sonnet · high/ }),
    );
    await waitFor(() => expect(errors).toEqual(["project is not linked"]));
  });
});

describe("attach thread picker", () => {
  it("searches threads, hides already attached ones, and attaches the pick", async () => {
    const queries: unknown[] = [];
    const slot = renderSlot(
      { component: AttachThreadPicker },
      {
        taskId: TASK_ID,
        attachedThreadIds: ["thr_attached"],
        onError: () => {},
      },
      {
        rpc: {
          searchThreads: (raw: unknown) => {
            queries.push(rpcInput(raw).query);
            return {
              threads: [
                { id: "thr_attached", title: "Already here", status: "idle" },
                { id: "thr_free", title: "Refactor pass", status: "idle" },
              ],
            };
          },
          taskThreadsAttach: () => ({ threadId: "thr_free" }),
        },
      },
    );
    fireEvent.click(slot.getByRole("button", { name: "Attach thread" }));
    fireEvent.change(await slot.findByPlaceholderText("Search threads…"), {
      target: { value: "refactor" },
    });
    await waitFor(() => expect(queries).toContain("refactor"));
    const option = await slot.findByRole("option", { name: /Refactor pass/ });
    expect(slot.queryByRole("option", { name: /Already here/ })).toBeNull();

    fireEvent.click(option);
    await waitFor(() =>
      expect(
        slot.rpcCalls
          .filter((call) => call.method === "taskThreadsAttach")
          .map((call) => rpcInput(call.input)),
      ).toEqual([{ taskId: TASK_ID, threadId: "thr_free" }]),
    );
  });
});
