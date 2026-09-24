// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { requestAppAnnotationToggle } from "./app-target.js";

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
  const root = document.querySelector("bb-agent-annotations")?.shadowRoot;
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
          provider: "annotation",
          id: "ann_saved",
          label: '1. button#send "Send"',
        },
      ]),
    );
    expect(slot.inspection.rpcCalls[0]).toMatchObject({
      method: "save",
      input: {
        surface: "app",
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
    expect(document.querySelector("bb-agent-annotations")).toBeNull();
    expect(Reflect.get(globalThis, "__bbAgentAnnotations")).toBeUndefined();
  });
});
