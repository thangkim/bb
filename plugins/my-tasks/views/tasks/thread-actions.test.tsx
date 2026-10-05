// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import { makeSidebarThread, rpcInput } from "../../test-fixtures.js";

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
const { AttachThreadPicker, NewThreadMenu } =
  await import("./thread-actions.js");

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

const otherPreset = {
  ...preset,
  id: "01HZZZZZZZZZZZZZZZZZZZZZE2",
  name: "Opus · max",
  modelId: "claude-opus-5",
};

function delegateInputs(slot: {
  rpcCalls: { method: string; input: unknown }[];
}) {
  return slot.rpcCalls
    .filter((call) => call.method === "delegate")
    .map((call) => rpcInput(call.input));
}

describe("new thread menu", () => {
  it("starts a thread with the default preset in one click and opens it beside the list", async () => {
    window.localStorage.clear();
    const errors: string[] = [];
    const slot = renderSlot(
      { component: NewThreadMenu },
      {
        target: { kind: "task", taskId: TASK_ID },
        presets: [preset, otherPreset],
        onError: (message: string) => errors.push(message),
      },
      {
        rpc: { delegate: () => ({ threadId: "thr_new" }) },
        sidebarThreads: { threads: [makeSidebarThread("thr_new")] },
      },
    );
    fireEvent.click(slot.getByRole("button", { name: "New thread" }));
    await waitFor(() =>
      expect(slot.sidebarActionCalls).toEqual([
        { method: "open", threadId: "thr_new", options: { split: true } },
      ]),
    );
    expect(delegateInputs(slot)).toEqual([
      { taskId: TASK_ID, presetId: otherPreset.id },
    ]);
    expect(slot.navigateCalls).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("starts a thread with a preset picked from the menu and remembers it", async () => {
    const slot = renderSlot(
      { component: NewThreadMenu },
      {
        target: { kind: "task", taskId: TASK_ID },
        presets: [preset, otherPreset],
        onError: () => {},
      },
      {
        rpc: { delegate: () => ({ threadId: "thr_new" }) },
        sidebarThreads: { threads: [makeSidebarThread("thr_new")] },
      },
    );
    fireEvent.click(slot.getByRole("button", { name: "Choose thread preset" }));
    fireEvent.click(
      await slot.findByRole("menuitem", { name: /Sonnet · high/ }),
    );
    await waitFor(() =>
      expect(delegateInputs(slot)).toEqual([
        { taskId: TASK_ID, presetId: preset.id },
      ]),
    );
    await waitFor(() => expect(slot.sidebarActionCalls).toHaveLength(1));

    fireEvent.click(slot.getByRole("button", { name: "New thread" }));
    await waitFor(() =>
      expect(delegateInputs(slot)).toEqual([
        { taskId: TASK_ID, presetId: preset.id },
        { taskId: TASK_ID, presetId: preset.id },
      ]),
    );
  });

  it("reports a failed dispatch without opening anything", async () => {
    const errors: string[] = [];
    const slot = renderSlot(
      { component: NewThreadMenu },
      {
        target: { kind: "task", taskId: TASK_ID },
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
    await waitFor(() => expect(errors).toEqual(["project is not linked"]));
    expect(slot.sidebarActionCalls).toEqual([]);
    expect(slot.navigateCalls).toEqual([]);
  });
});

describe("attach thread picker", () => {
  it("searches threads, hides already attached ones, and attaches the pick", async () => {
    const queries: unknown[] = [];
    const slot = renderSlot(
      { component: AttachThreadPicker },
      {
        target: { kind: "task", taskId: TASK_ID },
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
