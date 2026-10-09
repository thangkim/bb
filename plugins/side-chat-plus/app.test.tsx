// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));
const { parsePanelParams } = await import("./app");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubRpcFetch(
  handler: (method: string, input: unknown) => unknown,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = String(url).split("/rpc/")[1] ?? "";
    const input: unknown = init?.body ? JSON.parse(String(init.body)) : null;
    const result = handler(decodeURIComponent(method), input);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result }),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("registrations", () => {
  it("registers the reply message action and the side-chat panel action", () => {
    expect(app.messageActions.map((action) => action.id)).toEqual([
      "reply-in-side-chat",
    ]);
    expect(app.threadPanelActions.map((action) => action.id)).toEqual([
      "side-chat",
    ]);
  });
});

describe("parsePanelParams", () => {
  it("narrows persisted params and rejects malformed values", () => {
    expect(
      parsePanelParams({
        threadId: "thr_fork",
        sourceThreadId: "thr_src",
        sourceMessageText: "anchor",
        sourceSeqEnd: 5,
      }),
    ).toEqual({
      threadId: "thr_fork",
      sourceThreadId: "thr_src",
      sourceMessageText: "anchor",
      sourceSeqEnd: 5,
    });
    expect(
      parsePanelParams({ threadId: "thr_fork", sourceThreadId: "thr_src" }),
    ).toEqual({
      threadId: "thr_fork",
      sourceThreadId: "thr_src",
      sourceMessageText: "",
      sourceSeqEnd: null,
    });
    expect(parsePanelParams(null)).toBeNull();
    expect(parsePanelParams({ threadId: "thr_fork" })).toBeNull();
  });
});

describe("reply-in-side-chat message action", () => {
  it("creates the fork then opens the panel tab pointing at it", async () => {
    const fetchMock = stubRpcFetch((method) => {
      expect(method).toBe("createSideChat");
      return { threadId: "thr_fork" };
    });
    const openPanel = vi.fn(() => true);

    await app.messageActions[0]!.run({
      threadId: "thr_src",
      message: {
        id: "msg_1",
        threadId: "thr_src",
        role: "assistant",
        text: "whole message text",
        sourceSeqEnd: 42,
        experimental_messageSeq: 42,
      },
      openPanel,
      composer: null,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/side-chat-plus/rpc/createSideChat",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(body).toEqual({
      sourceThreadId: "thr_src",
      sourceSeqEnd: 42,
      anchorText: "whole message text",
    });
    expect(openPanel).toHaveBeenCalledWith({
      actionId: "side-chat",
      title: "Side chat",
      params: {
        threadId: "thr_fork",
        sourceThreadId: "thr_src",
        sourceMessageText: "whole message text",
        sourceSeqEnd: 42,
      },
    });
  });

  it("single-flights a double invocation while the first fork RPC is pending", async () => {
    let resolveRpc!: (value: unknown) => void;
    const deferred = new Promise((resolve) => {
      resolveRpc = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await deferred;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { threadId: "thr_fork" } }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const openPanel = vi.fn(() => true);
    const context = {
      threadId: "thr_src",
      message: {
        id: "msg_1",
        threadId: "thr_src",
        role: "assistant" as const,
        text: "whole message text",
        sourceSeqEnd: 42,
        experimental_messageSeq: 42,
      },
      openPanel,
      composer: null,
    };

    const first = app.messageActions[0]!.run(context);
    const second = app.messageActions[0]!.run(context);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveRpc(undefined);
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(openPanel).toHaveBeenCalledTimes(1);

    await app.messageActions[0]!.run(context);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("anchors on the selection when invoked from the selection menu", async () => {
    stubRpcFetch(() => ({ threadId: "thr_fork" }));
    const openPanel = vi.fn(() => true);

    await app.messageActions[0]!.run({
      threadId: "thr_src",
      message: {
        id: "msg_1",
        threadId: "thr_src",
        role: "assistant",
        text: "whole message text",
        sourceSeqEnd: 42,
        experimental_messageSeq: 42,
      },
      selectedText: "just this part",
      openPanel,
      composer: null,
    });

    expect(openPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Side chat",
        params: expect.objectContaining({
          sourceMessageText: "just this part",
        }),
      }),
    );
  });
});

describe("SideChatPanel", () => {
  const params = {
    threadId: "thr_fork",
    sourceThreadId: "thr_src",
    sourceMessageText: "the **anchor** message",
    sourceSeqEnd: 7,
  };

  it("renders ThreadChat with the ReplyingTo header and send-to-main action", () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_src", params },
      { rpc: {} },
    );

    const chat = slot.getByTestId("bb-thread-chat");
    expect(chat.getAttribute("data-thread-id")).toBe("thr_fork");
    expect(chat.getAttribute("data-variant")).toBe("compact");
    expect(chat.getAttribute("data-layout")).toBe("contained");
    expect(chat.getAttribute("data-permission-policy")).toBe("editable");
    expect(chat.getAttribute("data-message-actions")).toBe("send-to-main");

    const leading = slot.getByTestId("bb-thread-chat-leading-content");
    expect(leading.textContent).toContain("Replying to");
    const markdown = leading.querySelector("[data-testid='bb-markdown']");
    expect(markdown?.textContent).toContain("**anchor**");

    const action = slot.getByTestId("bb-thread-chat-action-send-to-main");
    expect(action.getAttribute("data-roles")).toBe("assistant");
  });

  it("send-to-main queues the message text on the source thread through the public API", async () => {
    const create = vi.fn(async () => ({ id: "qm_1" }) as never);
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_src", params },
      { rpc: {}, sdk: { threads: { queuedMessages: { create } } } },
    );

    fireEvent.click(slot.getByTestId("bb-thread-chat-action-send-to-main"));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        threadId: "thr_src",
        input: [{ type: "text", text: "test message text", mentions: [] }],
        senderThreadId: "thr_fork",
      });
    });
    expect(slot.rpcCalls).toEqual([]);
  });

  it("shows the agent's label and relabels the tab when it arrives", async () => {
    const get = vi.fn(async () => ({ id: "thr_fork", title: null }) as never);
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_src", params },
      { rpc: {}, sdk: { threads: { get } } },
    );

    await waitFor(() => expect(get).toHaveBeenCalledWith({ threadId: "thr_fork" }));
    expect(
      slot.getByRole("button", { name: "Rename side chat" }).textContent,
    ).toContain("Naming after the first reply");
    expect(slot.navigateCalls).toEqual([]);

    await slot.emitRealtime("side-chat:title", {
      threadId: "thr_other",
      title: "Not mine",
    });
    await slot.emitRealtime("side-chat:title", {
      threadId: "thr_fork",
      title: "Retry policy",
    });

    expect(
      slot.getByRole("button", { name: "Rename side chat" }).textContent,
    ).toContain("Retry policy");
    expect(slot.navigateCalls).toEqual([
      {
        method: "openThreadPanel",
        options: { actionId: "side-chat", title: "Retry policy", params },
      },
    ]);
  });

  it("renames the side chat thread inline and keeps the tab in step", async () => {
    const get = vi.fn(
      async () => ({ id: "thr_fork", title: "Retry policy" }) as never,
    );
    const update = vi.fn(async () => ({}) as never);
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_src", params },
      { rpc: {}, sdk: { threads: { get, update } } },
    );

    const button = await slot.findByRole("button", {
      name: "Rename side chat",
    });
    await waitFor(() => expect(button.textContent).toContain("Retry policy"));
    fireEvent.click(button);
    const input = slot.getByRole("textbox", { name: "Side chat title" });
    fireEvent.change(input, { target: { value: "  Backoff   limits " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        threadId: "thr_fork",
        title: "Backoff limits",
      }),
    );
    expect(slot.navigateCalls).toEqual([
      {
        method: "openThreadPanel",
        options: { actionId: "side-chat", title: "Retry policy", params },
      },
      {
        method: "openThreadPanel",
        options: { actionId: "side-chat", title: "Backoff limits", params },
      },
    ]);
  });

  it("discards an edit on Escape", async () => {
    const update = vi.fn();
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_src", params },
      {
        rpc: {},
        sdk: {
          threads: {
            get: vi.fn(async () => ({ id: "thr_fork", title: "Keep" }) as never),
            update,
          },
        },
      },
    );
    const button = await slot.findByRole("button", { name: "Rename side chat" });
    await waitFor(() => expect(button.textContent).toContain("Keep"));
    fireEvent.click(button);
    const input = slot.getByRole("textbox", { name: "Side chat title" });
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(
      slot.getByRole("button", { name: "Rename side chat" }).textContent,
    ).toContain("Keep");
    expect(update).not.toHaveBeenCalled();
  });

  it("reports a missing thread reference for malformed params", () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_src", params: { bogus: true } },
      { rpc: {} },
    );
    expect(slot.getByRole("alert").textContent).toContain(
      "missing its thread reference",
    );
  });
});
