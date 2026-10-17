// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
const { ComposeAnchor } = await import("./composer-beside.js");

afterEach(cleanup);

const TASK_ID = "01HZZZZZZZZZZZZZZZZZZZZZT1";
const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";

describe("new thread button", () => {
  const hostClicks: { href: string | null; metaKey: boolean }[] = [];

  function hostRouteAnchorDelegate(event: MouseEvent): void {
    if (!(event.target instanceof HTMLAnchorElement)) return;
    hostClicks.push({
      href: event.target.getAttribute("href"),
      metaKey: event.metaKey,
    });
    event.preventDefault();
  }

  beforeEach(() => {
    hostClicks.length = 0;
    document.addEventListener("click", hostRouteAnchorDelegate);
  });

  afterEach(() => {
    document.removeEventListener("click", hostRouteAnchorDelegate);
  });

  function render(options: {
    anchor?: boolean;
    compose?: () => unknown;
    target?: { kind: "task"; taskId: string };
  }) {
    if (options.anchor !== false) renderSlot({ component: ComposeAnchor }, {});
    const errors: string[] = [];
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
      },
    );
    return { slot, errors };
  }

  it("asks bb to open its composer beside the list for the linked project without starting a thread", async () => {
    const { slot, errors } = render({});
    fireEvent.click(slot.getByRole("button", { name: "New thread" }));
    await waitFor(() =>
      expect(slot.navigateCalls).toEqual([
        {
          method: "toCompose",
          options: { projectId: "proj_linked", focusPrompt: true },
        },
      ]),
    );
    expect(hostClicks).toEqual([{ href: "/", metaKey: true }]);
    expect(
      slot.rpcCalls.map((call) => [call.method, rpcInput(call.input)]),
    ).toEqual([["projectThreadsCompose", { projectId: PROJECT_ID }]]);
    expect(errors).toEqual([]);
  });

  it("claims the composer for a task target", async () => {
    const { slot } = render({ target: { kind: "task", taskId: TASK_ID } });
    fireEvent.click(slot.getByRole("button", { name: "New thread" }));
    await waitFor(() => expect(slot.navigateCalls).toHaveLength(1));
    expect(hostClicks).toHaveLength(1);
    expect(
      slot.rpcCalls.map((call) => [call.method, rpcInput(call.input)]),
    ).toEqual([["taskThreadsCompose", { taskId: TASK_ID }]]);
  });

  it("opens the new-thread screen in place when the split anchor is not mounted", async () => {
    const { slot } = render({ anchor: false });
    fireEvent.click(slot.getByRole("button", { name: "New thread" }));
    await waitFor(() =>
      expect(slot.navigateCalls).toEqual([
        {
          method: "toCompose",
          options: { projectId: "proj_linked", focusPrompt: true },
        },
      ]),
    );
    expect(hostClicks).toEqual([]);
  });

  it("reports a failed claim and opens nothing", async () => {
    const { slot, errors } = render({
      compose: () => {
        throw new Error("Project is not linked to a bb project");
      },
    });
    fireEvent.click(slot.getByRole("button", { name: "New thread" }));
    await waitFor(() =>
      expect(errors).toEqual(["Project is not linked to a bb project"]),
    );
    expect(hostClicks).toEqual([]);
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
