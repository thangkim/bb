// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { requestAppAnnotationToggle } from "./app-target.js";
import { ANNOTATION_CONTROLLER_KEY } from "./page-script.js";

const app = await loadPluginApp(() => import("./app"));

function overlay() {
  const registration = app.appOverlays.find(
    (candidate) => candidate.id === "app-annotations",
  );
  if (registration === undefined) {
    throw new Error("Expected the app annotations overlay.");
  }
  return registration;
}

function shadowRoot(): ShadowRoot {
  const root = document.querySelector("bb-building-mode")?.shadowRoot;
  if (root === null || root === undefined) {
    throw new Error("Expected the annotation overlay to be mounted.");
  }
  return root;
}

function requireElement<T extends Element>(element: T | null): T {
  if (element === null) {
    throw new Error("Expected element to exist.");
  }
  return element;
}

let appSurface: HTMLElement;
let button: HTMLButtonElement;

beforeEach(() => {
  appSurface = document.createElement("div");
  appSurface.innerHTML =
    '<main data-bb-src="apps/app/src/views/Thread.tsx:20:5"><button id="send" data-bb-src="packages/shared-ui/src/button.tsx:52:5">Send</button></main>';
  document.body.append(appSurface);
  button = requireElement(document.querySelector<HTMLButtonElement>("#send"));
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [button, document.body, document.documentElement],
  });
});

afterEach(() => {
  cleanup();
  appSurface.remove();
  Reflect.deleteProperty(document, "elementsFromPoint");
});

describe("AppAnnotationsOverlay", () => {
  it("annotates bb's own interface from the command and adds source-mapped context", async () => {
    const slot = renderSlot(
      overlay(),
      {},
      { rpc: { save: () => ({ id: "ann_saved" }) } },
    );
    expect(slot.queryByRole("status")).toBeNull();
    function SendButton() {}
    Object.assign(SendButton, {
      __bbSource: "packages/shared-ui/src/button.tsx:45:7",
    });
    function Composer() {}
    Reflect.set(button, "__reactFiber$app", {
      type: "button",
      _debugOwner: {
        type: SendButton,
        _debugOwner: {
          type: Composer,
          _debugStack: {
            stack:
              "Error\n    at Composer (http://127.0.0.1:26846/assets/index-abc.js:1:2)",
          },
          _debugOwner: null,
        },
      },
      return: null,
    });

    act(() => requestAppAnnotationToggle());
    expect((await slot.findByRole("status")).textContent).toContain(
      "Annotating bb",
    );

    button.click();
    const textarea = requireElement(shadowRoot().querySelector("textarea"));
    textarea.value = "Align this with the model picker";
    textarea.dispatchEvent(new Event("input"));
    requireElement(
      shadowRoot().querySelector<HTMLButtonElement>(".save"),
    ).click();

    await waitFor(() =>
      expect(slot.inspection.composer.mentions).toEqual([
        {
          provider: "bb-ui-annotation",
          id: "ann_saved",
          label: '1. <SendButton> button: "Send"',
        },
      ]),
    );
    expect(slot.inspection.rpcCalls[0]).toMatchObject({
      method: "save",
      input: {
        comment: "Align this with the model picker",
        components: [
          {
            name: "SendButton",
            source: "packages/shared-ui/src/button.tsx:45:7",
          },
          { name: "Composer", source: null },
        ],
        element: {
          sources: [
            "packages/shared-ui/src/button.tsx:52:5",
            "apps/app/src/views/Thread.tsx:20:5",
          ],
          pluginId: null,
        },
      },
    });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await waitFor(() => expect(slot.queryByRole("status")).toBeNull());
    expect(shadowRoot().querySelector(".pin")?.textContent).toBe("1");

    act(() => requestAppAnnotationToggle());
    await slot.findByRole("status");
    cleanup();
    expect(document.querySelector("bb-building-mode")).toBeNull();
    expect(Reflect.get(globalThis, ANNOTATION_CONTROLLER_KEY)).toBeUndefined();
  });

  it("removes a deleted pin's mention and clears pins when the composer changes", async () => {
    const slot = renderSlot(
      overlay(),
      {},
      {
        context: { threadId: "thr_1" },
        rpc: {
          save: (input) => ({
            id: z.object({ id: z.string() }).parse(input).id,
          }),
        },
      },
    );
    act(() => requestAppAnnotationToggle());
    await slot.findByRole("status");

    for (const comment of ["First", "Second"]) {
      button.click();
      const textarea = requireElement(shadowRoot().querySelector("textarea"));
      textarea.value = comment;
      textarea.dispatchEvent(new Event("input"));
      requireElement(
        shadowRoot().querySelector<HTMLButtonElement>(".save"),
      ).click();
    }
    await waitFor(() =>
      expect(slot.inspection.composer.mentions).toHaveLength(2),
    );
    const [first, second] = slot.inspection.composer.mentions;

    requireElement(
      shadowRoot().querySelector<HTMLButtonElement>(".pin"),
    ).click();
    const remove = Array.from(shadowRoot().querySelectorAll("button")).find(
      (node) => node.textContent === "Delete",
    );
    if (remove === undefined) throw new Error("Expected delete action");
    remove.click();
    await waitFor(() =>
      expect(slot.inspection.composer.mentions).toEqual([second]),
    );
    expect(first).toBeDefined();
    expect(shadowRoot().querySelectorAll(".pin")).toHaveLength(1);

    await slot.setComposerScope({ kind: "thread", threadId: "thr_2" });
    await waitFor(() =>
      expect(shadowRoot().querySelectorAll(".pin")).toHaveLength(0),
    );
    expect(slot.queryByRole("status")?.textContent).toContain("Annotating bb");
  });
});
