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
const { AttachThreadPicker, NewThreadButton } =
  await import("./thread-actions.js");

afterEach(cleanup);

const TASK_ID = "01HZZZZZZZZZZZZZZZZZZZZZT1";
const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";

describe("new thread button", () => {
  function render(options: {
    splitResult?: "opened" | "focused" | "replaced" | "at-cap" | "unavailable";
    compose?: () => unknown;
    target?: { kind: "task"; taskId: string };
  }) {
    const errors: string[] = [];
    const splitCalls: unknown[] = [];
    const slot = renderSlot(
      { component: NewThreadButton },
      {
        target: options.target ?? { kind: "project", projectId: PROJECT_ID },
        projectId: PROJECT_ID,
        linked: true,
        compact: true,
        onError: (message: string) => errors.push(message),
      },
      {
        rpc: {
          projectThreadsCompose:
            options.compose ?? (() => ({ bbProjectId: "proj_linked" })),
          taskThreadsCompose:
            options.compose ?? (() => ({ bbProjectId: "proj_linked" })),
        },
        ...(options.splitResult === undefined
          ? {}
          : {
              experimental_splitPanes: {
                isAvailable: true,
                openNewThread: (input: unknown) => {
                  splitCalls.push(input);
                  return options.splitResult!;
                },
              },
            }),
      },
    );
    return { slot, errors, splitCalls };
  }

  it("opens an empty composer for the linked project beside the list without starting a thread", async () => {
    const { slot, errors, splitCalls } = render({ splitResult: "opened" });
    fireEvent.click(slot.getByRole("button", { name: "New thread" }));
    await waitFor(() =>
      expect(splitCalls).toEqual([
        {
          side: "right",
          projectId: "proj_linked",
          focusPrompt: true,
          reuseComposer: true,
        },
      ]),
    );
    expect(
      slot.rpcCalls.map((call) => [call.method, rpcInput(call.input)]),
    ).toEqual([["projectThreadsCompose", { projectId: PROJECT_ID }]]);
    expect(slot.sidebarActionCalls).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("claims the composer for a task target", async () => {
    const { slot, splitCalls } = render({
      splitResult: "opened",
      target: { kind: "task", taskId: TASK_ID },
    });
    fireEvent.click(slot.getByRole("button", { name: "New thread" }));
    await waitFor(() => expect(splitCalls).toHaveLength(1));
    expect(
      slot.rpcCalls.map((call) => [call.method, rpcInput(call.input)]),
    ).toEqual([["taskThreadsCompose", { taskId: TASK_ID }]]);
  });

  it("falls back to the new-thread screen when splits are unavailable or full", async () => {
    for (const splitResult of [undefined, "at-cap"] as const) {
      const { slot } = render({ splitResult });
      fireEvent.click(slot.getByRole("button", { name: "New thread" }));
      await waitFor(() =>
        expect(slot.sidebarActionCalls).toEqual([
          {
            method: "openNewThread",
            options: { projectId: "proj_linked", focusPrompt: true },
          },
        ]),
      );
      cleanup();
    }
  });

  it("reports a failed claim and opens nothing", async () => {
    const { slot, errors, splitCalls } = render({
      splitResult: "opened",
      compose: () => {
        throw new Error("Project is not linked to a bb project");
      },
    });
    fireEvent.click(slot.getByRole("button", { name: "New thread" }));
    await waitFor(() =>
      expect(errors).toEqual(["Project is not linked to a bb project"]),
    );
    expect(splitCalls).toEqual([]);
    expect(slot.sidebarActionCalls).toEqual([]);
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
