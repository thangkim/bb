// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  MENTION_PREVIEW_CLOSE_DELAY_MS,
  MENTION_PREVIEW_OPEN_DELAY_MS,
  annotationIdForPill,
  previewPlacement,
} from "./mention-preview.js";

const app = await loadPluginApp(() => import("./app"));

const FULL_CONTEXT = [
  "## bb UI feedback: /projects/proj_1/threads/thr_1",
  "",
  '### 1. <Button> button: "Full Screen (⇧ ⌘ E) and the rest of a long label"',
  "**Feedback:** Hovering on this should show the full prompt in popover",
].join("\n");

function overlay() {
  const registration = app.appOverlays.find(
    (candidate) => candidate.id === "annotation-mention-preview",
  );
  if (registration === undefined) {
    throw new Error("Expected the annotation mention preview overlay.");
  }
  return registration;
}

function pillElement(resource: unknown): HTMLElement {
  const pill = document.createElement("span");
  pill.className = "group prompt-mention-pill";
  pill.setAttribute("data-prompt-mention", "true");
  pill.setAttribute(
    "data-prompt-mention-resource",
    typeof resource === "string" ? resource : JSON.stringify(resource),
  );
  const label = document.createElement("span");
  label.className = "truncate";
  label.textContent = '#1 <Button> button: "Full Screen (⇧ ⌘ E)..."';
  pill.append(label);
  return pill;
}

function annotationResource(itemId = "bb-ui-annotation:ann_1") {
  return {
    kind: "plugin",
    pluginId: "building-mode",
    itemId,
    label: '#1 <Button> button: "Full Screen (⇧ ⌘ E)..."',
  };
}

function mountPill(resource: unknown = annotationResource()) {
  const pill = pillElement(resource);
  editor.append(pill);
  const label = pill.firstElementChild;
  if (!(label instanceof HTMLElement)) throw new Error("Expected a label.");
  return { pill, label };
}

function renderOverlay(preview: (input: { id: string }) => unknown) {
  const calls: string[] = [];
  renderSlot(
    overlay(),
    {},
    {
      pluginId: "building-mode",
      rpc: {
        preview: (input: { id: string }) => {
          calls.push(input.id);
          return preview(input);
        },
      },
    },
  );
  return calls;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

let editor: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  editor = document.createElement("div");
  editor.id = "thread-detail-follow-up-composer";
  editor.setAttribute("contenteditable", "true");
  document.body.append(editor);
});

afterEach(() => {
  cleanup();
  editor.remove();
  vi.useRealTimers();
});

describe("annotationIdForPill", () => {
  it("reads this plugin's annotation id and rejects everything else", () => {
    expect(
      annotationIdForPill(pillElement(annotationResource()), "building-mode"),
    ).toBe("ann_1");
    expect(
      annotationIdForPill(pillElement(annotationResource()), "other-plugin"),
    ).toBeNull();
    expect(
      annotationIdForPill(
        pillElement(annotationResource("other-provider:ann_1")),
        "building-mode",
      ),
    ).toBeNull();
    expect(
      annotationIdForPill(
        pillElement(annotationResource("bb-ui-annotation:")),
        "building-mode",
      ),
    ).toBeNull();
    expect(
      annotationIdForPill(
        pillElement({ kind: "thread", threadId: "thr_1", label: "Thread" }),
        "building-mode",
      ),
    ).toBeNull();
    expect(
      annotationIdForPill(pillElement("{not json"), "building-mode"),
    ).toBeNull();
  });
});

describe("previewPlacement", () => {
  const viewport = { width: 1280, height: 800 };

  it("opens above a pill near the bottom of the window", () => {
    expect(
      previewPlacement({ top: 700, bottom: 720, left: 100 }, viewport),
    ).toEqual({
      left: 100,
      width: 512,
      maxHeight: 384,
      top: null,
      bottom: 106,
    });
  });

  it("opens below a pill near the top and keeps inside the window", () => {
    expect(
      previewPlacement({ top: 40, bottom: 60, left: 1200 }, viewport),
    ).toEqual({ left: 760, width: 512, maxHeight: 384, top: 66, bottom: null });
  });

  it("shrinks to a narrow window", () => {
    const placement = previewPlacement(
      { top: 500, bottom: 520, left: 50 },
      { width: 320, height: 600 },
    );
    expect(placement.width).toBe(304);
    expect(placement.left).toBe(8);
  });
});

describe("AnnotationMentionPreviewOverlay", () => {
  it("shows the full prompt after a hover delay and hides after leaving", async () => {
    const calls = renderOverlay(() => ({ context: FULL_CONTEXT }));
    const { label } = mountPill();

    fireEvent.pointerOver(label);
    await advance(MENTION_PREVIEW_OPEN_DELAY_MS - 1);
    expect(screen.queryByRole("tooltip")).toBeNull();

    await advance(1);
    const tooltip = screen.getByRole("tooltip");
    expect(calls).toEqual(["ann_1"]);
    expect(tooltip.textContent).toContain(
      "**Feedback:** Hovering on this should show the full prompt in popover",
    );
    expect(tooltip.textContent).toContain(
      "Full Screen (⇧ ⌘ E) and the rest of a long label",
    );

    fireEvent.pointerOver(tooltip);
    await advance(MENTION_PREVIEW_CLOSE_DELAY_MS * 2);
    expect(screen.queryByRole("tooltip")).not.toBeNull();

    fireEvent.pointerOver(editor);
    await advance(MENTION_PREVIEW_CLOSE_DELAY_MS);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not open when the pointer passes over a pill quickly", async () => {
    const calls = renderOverlay(() => ({ context: FULL_CONTEXT }));
    const { label } = mountPill();

    fireEvent.pointerOver(label);
    await advance(MENTION_PREVIEW_OPEN_DELAY_MS / 2);
    fireEvent.pointerOver(editor);
    await advance(MENTION_PREVIEW_OPEN_DELAY_MS * 2);

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("ignores other mention pills", async () => {
    const calls = renderOverlay(() => ({ context: FULL_CONTEXT }));
    const thread = mountPill({ kind: "thread", threadId: "thr_1", label: "T" });
    const foreign = mountPill({
      ...annotationResource(),
      pluginId: "another-plugin",
    });

    fireEvent.pointerOver(thread.label);
    await advance(MENTION_PREVIEW_OPEN_DELAY_MS);
    fireEvent.pointerOver(foreign.label);
    await advance(MENTION_PREVIEW_OPEN_DELAY_MS);

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("says when the annotation behind a pill is gone", async () => {
    renderOverlay(() => ({ context: null }));
    const { label } = mountPill();

    fireEvent.pointerOver(label);
    await advance(MENTION_PREVIEW_OPEN_DELAY_MS);

    expect(screen.getByRole("tooltip").textContent).toContain(
      "This annotation is no longer available.",
    );
  });

  it("keeps editor focus when the popover is pressed and closes on typing", async () => {
    renderOverlay(() => ({ context: FULL_CONTEXT }));
    const { label } = mountPill();
    editor.focus();

    fireEvent.pointerOver(label);
    await advance(MENTION_PREVIEW_OPEN_DELAY_MS);
    const tooltip = screen.getByRole("tooltip");

    fireEvent.pointerDown(tooltip);
    expect(fireEvent.mouseDown(tooltip)).toBe(false);
    expect(screen.queryByRole("tooltip")).not.toBeNull();
    expect(document.activeElement).toBe(editor);

    fireEvent.keyDown(editor, { key: "a" });
    await advance(0);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes when the pill is removed from the editor", async () => {
    renderOverlay(() => ({ context: FULL_CONTEXT }));
    const { pill, label } = mountPill();

    fireEvent.pointerOver(label);
    await advance(MENTION_PREVIEW_OPEN_DELAY_MS);
    expect(screen.queryByRole("tooltip")).not.toBeNull();

    pill.remove();
    fireEvent.scroll(editor);
    await advance(0);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
