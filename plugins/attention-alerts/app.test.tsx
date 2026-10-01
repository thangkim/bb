// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Alert, Ring } from "./contract.js";

const app = await loadPluginApp(() => import("./app"));

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    FakeNotification.instances.push(this);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
}

const started: number[] = [];
let audioState: AudioContextState = "running";

class FakeAudioContext {
  sampleRate = 8_000;
  destination = {};
  get state() {
    return audioState;
  }
  async resume() {}
  async close() {}
  createBuffer(_channels: number, length: number) {
    return { length, copyToChannel() {} };
  }
  createGain() {
    const node = {
      gain: { value: 1 },
      connect: () => node,
    };
    return node;
  }
  createBufferSource() {
    const gainValue = { current: 0 };
    return {
      buffer: null,
      connect: (gain: { gain: { value: number } }) => {
        gainValue.current = gain.gain.value;
        return gain;
      },
      start: () => started.push(gainValue.current),
    };
  }
}

let focused = false;

beforeEach(() => {
  FakeNotification.instances = [];
  FakeNotification.permission = "granted";
  started.length = 0;
  audioState = "running";
  focused = false;
  vi.stubGlobal("Notification", FakeNotification);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "alert-1",
    threadId: "thread-1",
    projectId: "project-1",
    interactionId: null,
    kind: "question",
    title: "Fix the flaky test",
    body: "Which database should I use?",
    createdAt: Date.now(),
    ...overrides,
  };
}

function ring(alerts: Alert[], overrides: Partial<Ring> = {}): Ring {
  return {
    ringId: "ring-1",
    reason: "new",
    sound: "attention",
    alerts,
    ...overrides,
  };
}

function overlay() {
  const registration = app.appOverlays[0];
  if (!registration) throw new Error("Expected the alerts overlay");
  return registration;
}

describe("attention overlay", () => {
  it("stacks open alerts newest first and dismisses or opens them", async () => {
    let open = [
      alert({ id: "a3", kind: "done", title: "Fixed the build", body: null }),
      alert({ id: "a2", kind: "error", title: "Failed to deploy" }),
      alert({ id: "a1", kind: "plan", title: "First" }),
      alert({ id: "a0", title: "Zeroth" }),
    ];
    const slot = renderSlot(
      overlay(),
      {},
      {
        rpc: {
          "alerts.list": () => ({ alerts: open }),
          "alerts.dismiss": (input: unknown) => {
            const id = Reflect.get(Object(input), "id");
            open = open.filter((item) => item.id !== id);
            return { dismissed: true };
          },
        },
        settings: { clearFinishedOnOpen: false },
      },
    );

    expect(await slot.findByText("4 alerts need you")).toBeTruthy();
    const headlines = slot
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    expect(headlines).toHaveLength(3);
    expect(headlines[0]).toBe("Fixed the buildjust now");
    expect(headlines[1]).toContain("Failed to deploy");
    expect(headlines[2]).toContain("First");
    expect(slot.getByLabelText("Done").getAttribute("class")).toContain(
      "text-success",
    );
    expect(slot.getByLabelText("Failed").getAttribute("class")).toContain(
      "text-destructive",
    );
    expect(slot.getByLabelText("Plan review").getAttribute("class")).toContain(
      "text-warning",
    );

    fireEvent.click(slot.getByText("+1 more"));
    expect(slot.getAllByRole("listitem")).toHaveLength(4);

    fireEvent.click(slot.getByText("Fixed the build"));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thread-1",
    });

    fireEvent.click(slot.getByLabelText("Dismiss Failed to deploy"));
    await waitFor(() =>
      expect(slot.getAllByRole("listitem")).toHaveLength(3),
    );
    expect(slot.inspection.rpcCalls).toContainEqual({
      method: "alerts.dismiss",
      input: { id: "a2" },
    });
  });

  it("claims a ring in the background, plays it, and posts a sticky notification per alert", async () => {
    const first = alert({ id: "a1" });
    const second = alert({ id: "a2", threadId: "thread-2", kind: "done" });
    const slot = renderSlot(
      overlay(),
      {},
      {
        rpc: {
          "alerts.list": () => ({ alerts: [first, second] }),
          "rings.claim": () => ({ claimed: true }),
        },
        settings: { volume: 50 },
      },
    );
    await slot.findByText("2 alerts need you");

    await slot.behavior.emitRealtime("alerts.ring", ring([first, second]));

    await waitFor(() => expect(started).toEqual([0.5]));
    expect(FakeNotification.instances.map((item) => item.options)).toEqual([
      expect.objectContaining({
        tag: "bb-attention-a1",
        requireInteraction: true,
        silent: true,
      }),
      expect.objectContaining({ tag: "bb-attention-a2" }),
    ]);
    expect(FakeNotification.instances[0]?.title).toBe(
      "Fix the flaky test",
    );

    await act(async () => FakeNotification.instances[1]?.onclick?.());
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thread-2",
    });
  });

  it("closes system notifications once their alerts are resolved", async () => {
    let open = [alert({ id: "a1" })];
    const slot = renderSlot(
      overlay(),
      {},
      {
        rpc: {
          "alerts.list": () => ({ alerts: open }),
          "rings.claim": () => ({ claimed: true }),
        },
      },
    );
    await slot.findByText("1 alert needs you");
    await slot.behavior.emitRealtime("alerts.ring", ring(open));
    await waitFor(() => expect(FakeNotification.instances).toHaveLength(1));

    open = [];
    await slot.behavior.emitRealtime("alerts.changed", { count: 0 });
    await waitFor(() =>
      expect(FakeNotification.instances[0]?.closed).toBe(true),
    );
    expect(slot.queryByLabelText("Attention alerts")).toBeNull();
  });

  it("stays silent when another window claimed the ring", async () => {
    const slot = renderSlot(
      overlay(),
      {},
      {
        rpc: {
          "alerts.list": () => ({ alerts: [alert()] }),
          "rings.claim": () => ({ claimed: false }),
        },
      },
    );
    await slot.findByText("1 alert needs you");
    await slot.behavior.emitRealtime("alerts.ring", ring([alert()]));
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.some((call) => call.method === "rings.claim"),
      ).toBe(true),
    );
    expect(started).toEqual([]);
    expect(FakeNotification.instances).toEqual([]);
  });

  it("leaves the ring for another window or the Mac when this one cannot play sound", async () => {
    audioState = "suspended";
    const slot = renderSlot(
      overlay(),
      {},
      {
        rpc: {
          "alerts.list": () => ({ alerts: [alert()] }),
          "rings.claim": () => ({ claimed: true }),
        },
      },
    );
    await slot.findByText("1 alert needs you");
    await slot.behavior.emitRealtime("alerts.ring", ring([alert()]));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "rings.claim"),
    ).toBe(false);
  });

  it("clears a finished alert for the thread you are looking at, without sound", async () => {
    focused = true;
    const finished = alert({ id: "a1", kind: "done" });
    let open = [finished];
    const slot = renderSlot(
      overlay(),
      {},
      {
        rpc: {
          "alerts.list": () => ({ alerts: open }),
          "alerts.dismiss": () => {
            open = [];
            return { dismissed: true };
          },
          "rings.claim": () => ({ claimed: true }),
        },
        context: { threadId: "thread-1" },
      },
    );
    await slot.behavior.emitRealtime("alerts.ring", ring([finished]));
    await waitFor(() =>
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "alerts.dismiss",
        input: { id: "a1" },
      }),
    );
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "rings.claim"),
    ).toBe(false);
    expect(started).toEqual([]);
  });

  it("keeps a question on screen while you look at its thread", async () => {
    focused = true;
    const question = alert({ id: "a1" });
    const slot = renderSlot(
      overlay(),
      {},
      {
        rpc: {
          "alerts.list": () => ({ alerts: [question] }),
          "rings.claim": () => ({ claimed: true }),
        },
        context: { threadId: "thread-1" },
      },
    );
    await slot.findByText("1 alert needs you");
    await slot.behavior.emitRealtime("alerts.ring", ring([question]));
    await waitFor(() => expect(started).toHaveLength(1));
    expect(FakeNotification.instances).toEqual([]);
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "alerts.dismiss"),
    ).toBe(false);
  });
});
