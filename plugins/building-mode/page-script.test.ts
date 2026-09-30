// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageMessageSchema } from "./annotations.js";
import {
  ANNOTATION_CONTROLLER_KEY,
  installBuildingMode,
  probeReactComponents,
  type AnnotationController,
} from "./page-script.js";

interface Bridge {
  postMessage(data: unknown): void;
}

const silent: Bridge = { postMessage: () => undefined };

function installedController(): AnnotationController | undefined {
  return Reflect.get(globalThis, ANNOTATION_CONTROLLER_KEY);
}

function activate(bridge: Bridge, theme: Record<string, string> = {}) {
  installBuildingMode(bridge, theme);
  const controller = installedController();
  if (controller === undefined) {
    throw new Error("Expected the page controller.");
  }
  return controller.activate();
}

function control(method: "deactivate" | "state" | "clear") {
  return installedController()?.[method]() ?? { active: false, count: 0 };
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

let button: HTMLButtonElement;

beforeEach(() => {
  document.body.innerHTML =
    '<main><h1>Checkout</h1><button id="pay" class="btn primary" aria-label="Pay now">Pay</button></main>';
  button = requireElement(document.querySelector<HTMLButtonElement>("#pay"));
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [button, document.body, document.documentElement],
  });
});

afterEach(() => {
  installedController()?.dispose();
  Reflect.deleteProperty(document, "elementsFromPoint");
});

describe("building mode page script", () => {
  it("selects the clicked element, captures a comment, and posts its context", () => {
    const messages: unknown[] = [];
    const bridge: Bridge = { postMessage: (data) => messages.push(data) };
    const pageClick = vi.fn();
    button.addEventListener("click", pageClick);

    expect(activate(bridge, { "--bb-primary": "oklch(0.55 0.2 250)" })).toEqual(
      { active: true, count: 0 },
    );

    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }),
    );
    expect(pageClick).not.toHaveBeenCalled();

    const root = shadowRoot();
    expect(root.querySelector(".target-tag")?.textContent).toBe("button");
    expect(root.querySelector(".target-text")?.textContent).toBe("Pay now");
    const save = requireElement(root.querySelector<HTMLButtonElement>(".save"));
    expect(save.disabled).toBe(true);
    const textarea = requireElement(root.querySelector("textarea"));
    textarea.value = "  Make this green  ";
    textarea.dispatchEvent(new Event("input"));
    expect(save.disabled).toBe(false);
    save.click();

    const parsed = messages.map((message) => pageMessageSchema.parse(message));
    expect(parsed[0]).toMatchObject({
      type: "annotation",
      annotation: {
        number: 1,
        comment: "Make this green",
        element: {
          tagName: "button",
          selector: "#pay",
          text: "Pay",
          pluginId: null,
          attributes: {
            id: "pay",
            class: "btn primary",
            "aria-label": "Pay now",
          },
        },
      },
    });
    expect(parsed[1]).toEqual({ type: "state", active: true, count: 1 });
    const first = parsed[0];
    if (first?.type !== "annotation") {
      throw new Error("Expected an annotation message first.");
    }
    expect(button.hasAttribute(`data-bb-building-${first.annotation.id}`)).toBe(
      true,
    );
    expect(root.querySelector(".pin")?.textContent).toBe("1");
    expect(root.querySelector(".editor")).toBeNull();
  });

  it("edits an existing pin while inactive, preserves its identity, and cancels changes", () => {
    const messages: unknown[] = [];
    const bridge: Bridge = { postMessage: (data) => messages.push(data) };
    activate(bridge);
    button.click();
    const root = shadowRoot();
    const input = requireElement(root.querySelector("textarea"));
    input.value = "Original";
    input.dispatchEvent(new Event("input"));
    requireElement(root.querySelector<HTMLButtonElement>(".save")).click();
    const created = pageMessageSchema.parse(messages[0]);
    if (created.type !== "annotation") throw new Error("Expected annotation");
    control("deactivate");
    const pin = requireElement(root.querySelector<HTMLButtonElement>(".pin"));
    pin.click();
    const edit = requireElement(root.querySelector("textarea"));
    expect(edit.value).toBe("Original");
    expect(root.querySelector(".save")?.textContent).toBe("Save");
    edit.value = "   ";
    edit.dispatchEvent(new Event("input"));
    expect(root.querySelector<HTMLButtonElement>(".save")?.disabled).toBe(true);
    edit.value = "Updated";
    edit.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }),
    );
    expect(messages.at(-1)).toEqual({
      type: "annotation-update",
      id: created.annotation.id,
      comment: "Updated",
    });
    expect(pin.title).toBe("Updated");
    expect(root.querySelectorAll(".pin")).toHaveLength(1);
    expect(control("state")).toEqual({
      active: false,
      count: 1,
    });
    pin.click();
    const cancelled = requireElement(root.querySelector("textarea"));
    expect(cancelled.value).toBe("Updated");
    cancelled.value = "Discard this";
    cancelled.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    pin.click();
    expect(root.querySelector("textarea")?.value).toBe("Updated");
    control("clear");
    expect(root.querySelector(".editor")).toBeNull();
    expect(root.querySelector(".pin")).toBeNull();
  });

  it("deletes a pin and its element marker without leaving an editor", () => {
    const messages: unknown[] = [];
    const bridge: Bridge = { postMessage: (data) => messages.push(data) };
    activate(bridge);
    button.click();
    const root = shadowRoot();
    const input = requireElement(root.querySelector("textarea"));
    input.value = "Delete me";
    input.dispatchEvent(new Event("input"));
    requireElement(root.querySelector<HTMLButtonElement>(".save")).click();
    const created = pageMessageSchema.parse(messages[0]);
    if (created.type !== "annotation") throw new Error("Expected annotation");
    requireElement(root.querySelector<HTMLButtonElement>(".pin")).click();
    const remove = Array.from(root.querySelectorAll("button")).find(
      (node) => node.textContent === "Delete",
    );
    if (!remove) throw new Error("Expected delete action");
    remove.click();
    expect(messages.slice(-2)).toEqual([
      { type: "annotation-delete", id: created.annotation.id },
      { type: "state", active: true, count: 0 },
    ]);
    expect(
      button.hasAttribute(`data-bb-building-${created.annotation.id}`),
    ).toBe(false);
    expect(root.querySelector(".pin")).toBeNull();
    expect(root.querySelector(".editor")).toBeNull();
  });

  it("turns off on Escape, releases page clicks, and reuses one overlay", () => {
    const messages: unknown[] = [];
    const bridge: Bridge = { postMessage: (data) => messages.push(data) };
    const pageClick = vi.fn();
    button.addEventListener("click", pageClick);
    activate(bridge);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(messages).toEqual([{ type: "state", active: false, count: 0 }]);
    expect(control("state")).toEqual({
      active: false,
      count: 0,
    });
    button.click();
    expect(pageClick).toHaveBeenCalledTimes(1);

    expect(activate(bridge)).toEqual({
      active: true,
      count: 0,
    });
    expect(document.querySelectorAll("bb-building-mode")).toHaveLength(1);
  });

  it("reads React component names and debug sources from DOM fibers", () => {
    button.setAttribute("data-bb-building-abc123", "");
    function SubmitButton() {}
    function CheckoutCard() {}
    Reflect.set(button, "__reactFiber$x1y2", {
      type: "button",
      return: {
        type: SubmitButton,
        _debugSource: { fileName: "src/SubmitButton.tsx", lineNumber: 12 },
        return: {
          type: { render: CheckoutCard },
          _debugStack: {
            stack:
              "Error\n    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:250:30)\n    at CheckoutPage (http://localhost:5173/src/CheckoutPage.tsx?t=17:40:7)",
          },
          return: null,
        },
      },
    });

    expect(probeReactComponents("abc123")).toEqual({
      components: [
        { name: "SubmitButton", source: "src/SubmitButton.tsx:12" },
        {
          name: "CheckoutCard",
          source: "http://localhost:5173/src/CheckoutPage.tsx:40:7",
        },
      ],
    });
    expect(probeReactComponents("missing1")).toBeNull();
    expect(() => probeReactComponents('x"]')).toThrow(/Invalid annotation id/);
  });

  it("follows the owner chain past library wrappers and minified names", () => {
    button.setAttribute("data-bb-building-abc123", "");
    function named(name: string) {
      const component = () => null;
      Object.defineProperty(component, "name", { value: name });
      return component;
    }
    function fiber(
      name: string,
      links: { owner?: object | null; parent?: object | null } = {},
    ) {
      return {
        type: named(name),
        _debugOwner: links.owner ?? null,
        return: links.parent ?? null,
      };
    }
    const app = fiber("ThreadListSidebar");
    const section = fiber("TopLevelSidebarSection", { owner: app });
    const trigger = fiber("ContextMenuTrigger", { owner: section });
    const primitive = fiber("Primitive.span", { owner: trigger });
    const slot = fiber("Primitive.span.SlotClone", { owner: primitive });
    const tier = fiber("SidebarStickyTier");
    const minified = fiber("_a", { parent: tier });
    const provider = fiber("MenuProvider", { parent: minified });
    Reflect.set(button, "__reactFiber$x1y2", {
      type: "button",
      _debugOwner: slot,
      return: provider,
    });

    expect(probeReactComponents("abc123")).toEqual({
      components: [
        { name: "ContextMenuTrigger", source: null },
        { name: "TopLevelSidebarSection", source: null },
        { name: "ThreadListSidebar", source: null },
      ],
    });

    Reflect.set(button, "__reactFiber$x1y2", {
      type: "button",
      _debugOwner: null,
      return: { ...slot, return: provider },
    });
    expect(probeReactComponents("abc123")).toEqual({
      components: [{ name: "SidebarStickyTier", source: null }],
    });

    const productionChain = [
      "MarkdownPreview",
      "Panel",
      "forwardRef(Panel)",
      "PanelGroup",
      "forwardRef(PanelGroup)",
      "Route",
      "SidebarInset",
      "Jie",
      "RenderedRoute",
      "aae",
    ].reduceRight<object | null>(
      (parent, name) => fiber(name, { parent }),
      null,
    );
    Reflect.set(button, "__reactFiber$x1y2", {
      type: "div",
      _debugOwner: null,
      return: productionChain,
    });
    expect(probeReactComponents("abc123")).toEqual({
      components: [
        "MarkdownPreview",
        "Panel",
        "PanelGroup",
        "SidebarInset",
        "Jie",
      ].map((name) => ({ name, source: null })),
    });
  });

  it("reports where each component is defined when the build recorded it", () => {
    button.setAttribute("data-bb-building-abc123", "");
    function ModelReasoningPicker() {}
    Object.assign(ModelReasoningPicker, {
      __bbSource:
        "apps/app/src/components/pickers/ModelReasoningPicker.tsx:88:8",
    });
    const forwardedButton = {
      render: function Button() {},
      __bbSource: "packages/shared-ui/src/components/ui/button.tsx:45:7",
    };
    Reflect.set(button, "__reactFiber$x1y2", {
      type: "button",
      _debugOwner: {
        type: forwardedButton,
        _debugOwner: { type: ModelReasoningPicker, _debugOwner: null },
      },
      return: null,
    });

    expect(probeReactComponents("abc123")).toEqual({
      components: [
        {
          name: "Button",
          source: "packages/shared-ui/src/components/ui/button.tsx:45:7",
        },
        {
          name: "ModelReasoningPicker",
          source:
            "apps/app/src/components/pickers/ModelReasoningPicker.tsx:88:8",
        },
      ],
    });
  });

  function placeAt(
    element: Element,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    Object.defineProperty(element, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(x, y, w, h),
    });
  }

  function pickedElementName(): string | null | undefined {
    document.body.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 200, clientY: 30 }),
    );
    return shadowRoot().querySelector(".editor-title")?.getAttribute("title");
  }

  it("looks through an empty hit-area overlay to the small element beneath it", () => {
    document.body.innerHTML = [
      '<div class="row relative">',
      '<button class="absolute inset-0" aria-label="Open UPM-1"></button>',
      '<span class="key">UPM-1</span>',
      '<div class="progress" aria-label="88% done"><div class="fill"></div></div>',
      "</div>",
    ].join("");
    const row = requireElement(document.querySelector(".row"));
    const overlay = requireElement(document.querySelector("button"));
    const progress = requireElement(document.querySelector(".progress"));
    const fill = requireElement(document.querySelector(".fill"));
    placeAt(row, 0, 0, 400, 60);
    placeAt(overlay, 0, 0, 400, 60);
    placeAt(progress, 180, 25, 60, 8);
    placeAt(fill, 180, 25, 50, 8);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [
        overlay,
        fill,
        progress,
        row,
        document.body,
        document.documentElement,
      ],
    });
    activate(silent);

    expect(pickedElementName()).toBe("div.fill");
  });

  it("keeps a visible button on top instead of looking beneath it", () => {
    document.body.innerHTML =
      '<div class="row"><button class="absolute inset-0">Open</button><span class="key">UPM-1</span></div>';
    const row = requireElement(document.querySelector(".row"));
    const overlay = requireElement(document.querySelector("button"));
    const key = requireElement(document.querySelector(".key"));
    placeAt(row, 0, 0, 400, 60);
    placeAt(overlay, 0, 0, 400, 60);
    placeAt(key, 150, 20, 60, 20);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [overlay, key, row, document.body, document.documentElement],
    });
    activate(silent);

    expect(pickedElementName()).toBe('button.absolute.inset-0 "Open"');
  });

  it("records a readable location and the text around the element", () => {
    document.body.innerHTML = [
      '<div class="flex-1"><div class="new-branch-modal"><div class="md:flex flex">',
      "<label>Branch name</label>",
      '<p class="hover:underline text-description-2xs text-danger-strong">Invalid characters</p>',
      "</div></div></div>",
    ].join("");
    const paragraph = requireElement(document.querySelector("p"));
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [paragraph, document.body, document.documentElement],
    });
    const messages: unknown[] = [];
    activate({
      postMessage: (data) => messages.push(data),
    });

    paragraph.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const root = shadowRoot();
    const textarea = requireElement(root.querySelector("textarea"));
    textarea.value = "Use the shortcut component";
    textarea.dispatchEvent(new Event("input"));
    requireElement(root.querySelector<HTMLButtonElement>(".save")).click();

    const created = pageMessageSchema.parse(messages[0]);
    if (created.type !== "annotation") throw new Error("Expected annotation");
    expect(created.annotation.element.selector).toBe(
      ".flex-1 > .new-branch-modal > .flex > p.text-description-2xs",
    );
    expect(created.annotation.element.context).toBe(
      "Branch nameInvalid characters",
    );
  });

  it("records the stamped source trail, one location per file, innermost first", () => {
    document.body.innerHTML = [
      '<main data-bb-src="apps/app/src/Checkout.tsx:4:5">',
      '<div data-bb-src="packages/shared-ui/src/button.tsx:8:3">',
      '<button id="pay" data-bb-src="packages/shared-ui/src/button.tsx:10:5">Pay</button>',
      "</div></main>",
    ].join("");
    button = requireElement(document.querySelector<HTMLButtonElement>("#pay"));
    const messages: unknown[] = [];
    activate({
      postMessage: (data) => messages.push(data),
    });

    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 10, clientY: 10 }),
    );
    const root = shadowRoot();
    expect(root.querySelector(".label")?.textContent).toContain(
      "button.tsx:10:5",
    );
    button.click();
    const textarea = requireElement(root.querySelector("textarea"));
    textarea.value = "Tighten the padding";
    textarea.dispatchEvent(new Event("input"));
    requireElement(root.querySelector<HTMLButtonElement>(".save")).click();

    const created = pageMessageSchema.parse(messages[0]);
    if (created.type !== "annotation") throw new Error("Expected annotation");
    expect(created.annotation.element.sources).toEqual([
      "packages/shared-ui/src/button.tsx:10:5",
      "apps/app/src/Checkout.tsx:4:5",
    ]);
  });

  it("records which plugin rendered the element, including portaled plugin overlays", () => {
    document.body.innerHTML = [
      '<main data-bb-src="apps/app/src/views/Thread.tsx:20:5">',
      '<div data-bb-plugin-root="" data-bb-plugin="notes" class="contents">',
      '<button id="pay">Save note</button>',
      "</div></main>",
      '<div data-bb-portaled-overlay="" data-bb-plugin="notes"><p id="menu">Rename</p></div>',
      '<p id="plain">Plain</p>',
    ].join("");
    const messages: unknown[] = [];
    activate({ postMessage: (data) => messages.push(data) });

    const created: string[] = [];
    for (const id of ["pay", "menu", "plain"]) {
      const target = requireElement(document.getElementById(id));
      Object.defineProperty(document, "elementsFromPoint", {
        configurable: true,
        value: () => [target, document.body, document.documentElement],
      });
      target.click();
      const textarea = requireElement(shadowRoot().querySelector("textarea"));
      textarea.value = `Change ${id}`;
      textarea.dispatchEvent(new Event("input"));
      requireElement(
        shadowRoot().querySelector<HTMLButtonElement>(".save"),
      ).click();
    }
    for (const message of messages) {
      const parsed = pageMessageSchema.parse(message);
      if (parsed.type === "annotation") {
        created.push(String(parsed.annotation.element.pluginId));
      }
    }

    expect(created).toEqual(["notes", "notes", "null"]);
  });

  it("keeps focus traps on the page from reclaiming focus from the comment editor", () => {
    const pageFocusIn = vi.fn();
    const pageFocusOut = vi.fn();
    document.addEventListener("focusin", pageFocusIn);
    document.addEventListener("focusout", pageFocusOut);
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    pageFocusIn.mockClear();
    activate(silent);

    button.click();
    const textarea = requireElement(shadowRoot().querySelector("textarea"));

    expect(shadowRoot().activeElement).toBe(textarea);
    expect(pageFocusIn).not.toHaveBeenCalled();
    expect(pageFocusOut).not.toHaveBeenCalled();
    field.focus();
    expect(pageFocusIn).toHaveBeenCalledTimes(1);
    document.removeEventListener("focusin", pageFocusIn);
    document.removeEventListener("focusout", pageFocusOut);
  });

  it("disposes the overlay, its pins, and the page controller", () => {
    activate(silent);
    button.click();
    const textarea = requireElement(shadowRoot().querySelector("textarea"));
    textarea.value = "Remove me";
    requireElement(
      shadowRoot().querySelector<HTMLButtonElement>(".save"),
    ).click();
    const controller: unknown = Reflect.get(
      globalThis,
      ANNOTATION_CONTROLLER_KEY,
    );
    if (typeof controller !== "object" || controller === null) {
      throw new Error("Expected the page controller.");
    }

    Reflect.get(controller, "dispose")();

    expect(document.querySelector("bb-building-mode")).toBeNull();
    expect(Reflect.get(globalThis, ANNOTATION_CONTROLLER_KEY)).toBeUndefined();
    expect(
      Array.from(button.attributes).some((attribute) =>
        attribute.name.startsWith("data-bb-building-"),
      ),
    ).toBe(false);
  });
});
