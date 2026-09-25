import { describe, expect, it } from "vitest";
import {
  annotationMentionLabel,
  annotationRecordSchema,
  formatAnnotationContext,
  type AnnotationRecord,
} from "./annotations.js";

const record: AnnotationRecord = {
  id: "mfx12abc",
  number: 2,
  comment: "The send button should say “Send now” instead",
  url: "http://127.0.0.1:26846/projects/proj_1/threads/thr_1?pane=2#end",
  title: "bb",
  viewport: { width: 1280, height: 720 },
  element: {
    tagName: "button",
    name: 'button#send.btn "Send message"',
    selector: "#send",
    text: "Send",
    attributes: { id: "send", "aria-label": "Send message" },
    rect: { x: 40, y: 300, width: 120, height: 36 },
    context: "Opus 5.5 1M High Send",
    sources: [],
    pluginId: null,
  },
  components: [
    { name: "SendButton", source: "apps/app/src/SendButton.tsx:12:8" },
    { name: "Composer", source: null },
  ],
};

describe("annotation formatting", () => {
  it("labels mentions with a stable element description", () => {
    expect(annotationMentionLabel(record)).toBe(
      '2. <SendButton> button: "Send message"',
    );
    expect(
      annotationMentionLabel({
        ...record,
        element: {
          ...record.element,
          tagName: "p",
          attributes: {},
          text: "Tests and typecheck pass for Building Mode",
        },
        components: [{ name: "MarkdownParagraph", source: null }],
      }),
    ).toBe(
      '2. <MarkdownParagraph> paragraph: "Tests and typecheck pass for Bui..."',
    );
    expect(
      annotationMentionLabel({
        ...record,
        element: { ...record.element, attributes: {}, text: "" },
        components: [],
      }),
    ).toBe("2. button");
  });

  it("formats an annotation as compact bb UI feedback for the current route", () => {
    expect(formatAnnotationContext(record)).toBe(
      [
        "## bb UI feedback: /projects/proj_1/threads/thr_1?pane=2#end",
        "**Viewport:** 1280×720",
        "",
        '### 2. <Composer> <SendButton> button: "Send message"',
        "**Location:** #send",
        "**Source:** SendButton (`apps/app/src/SendButton.tsx:12:8`)",
        "**React:** SendButton (`apps/app/src/SendButton.tsx:12:8`) › Composer",
        '**Attributes:** id="send", aria-label="Send message"',
        "**Position:** 40px, 300px (120×36px)",
        "**Context:** Opus 5.5 1M High Send",
        "**Feedback:** The send button should say “Send now” instead",
        "",
        "_Source paths are relative to the repository root; line:column points at the JSX tag or component declaration._",
      ].join("\n"),
    );
  });

  it("leads with the component that renders an unstamped element", () => {
    const context = formatAnnotationContext({
      ...record,
      element: {
        ...record.element,
        selector:
          'form > .flex > .flex > button[aria-label="Provider, model and reasoning"]',
        text: "Opus 5.5 1M High",
        attributes: {
          class: "inline-flex cursor-pointer whitespace-nowrap",
          "aria-label": "Provider, model and reasoning",
        },
        sources: [
          "apps/app/src/components/promptbox/PromptBoxInternal.tsx:3429:17",
          "apps/app/src/components/promptbox/FollowUpPromptBox.tsx:692:5",
        ],
      },
      components: [
        {
          name: "Button",
          source: "packages/shared-ui/src/components/ui/button.tsx:45:7",
        },
        { name: "PopoverTrigger", source: null },
        {
          name: "ModelReasoningPicker",
          source:
            "apps/app/src/components/pickers/ModelReasoningPicker.tsx:88:8",
        },
      ],
    });

    expect(context.split("\n").slice(0, 10)).toEqual([
      "## bb UI feedback: /projects/proj_1/threads/thr_1?pane=2#end",
      "**Viewport:** 1280×720",
      "",
      '### 2. <ModelReasoningPicker> <PopoverTrigger> <Button> button: "Provider, model and reasoning"',
      '**Location:** form > .flex > .flex > button[aria-label="Provider, model and reasoning"]',
      "**Source:** Button (`packages/shared-ui/src/components/ui/button.tsx:45:7`), inside ModelReasoningPicker (`apps/app/src/components/pickers/ModelReasoningPicker.tsx:88:8`)",
      "**Source trail:** `apps/app/src/components/promptbox/PromptBoxInternal.tsx:3429:17` › `apps/app/src/components/promptbox/FollowUpPromptBox.tsx:692:5`",
      "**React:** Button (`packages/shared-ui/src/components/ui/button.tsx:45:7`) › PopoverTrigger › ModelReasoningPicker (`apps/app/src/components/pickers/ModelReasoningPicker.tsx:88:8`)",
      "**Classes:** inline-flex, cursor-pointer, whitespace-nowrap",
      '**Attributes:** aria-label="Provider, model and reasoning"',
    ]);
  });

  it("prefers the element's own stamp and reports builds without stamps", () => {
    const stamped = formatAnnotationContext({
      ...record,
      element: {
        ...record.element,
        attributes: {
          ...record.element.attributes,
          "data-bb-src": "apps/app/src/Composer.tsx:12:5",
        },
        sources: ["apps/app/src/Composer.tsx:12:5"],
      },
    });
    expect(stamped).toContain("**Source:** `apps/app/src/Composer.tsx:12:5`");
    expect(stamped).not.toContain("data-bb-src=");

    const nearest = formatAnnotationContext({
      ...record,
      element: {
        ...record.element,
        sources: ["apps/app/src/Composer.tsx:40:3"],
      },
      components: [],
    });
    expect(nearest).toContain(
      "**Source:** `apps/app/src/Composer.tsx:40:3` (nearest stamped ancestor)",
    );

    const unstamped = formatAnnotationContext({
      ...record,
      components: [{ name: "Composer", source: null }],
    });
    expect(unstamped).toContain("this bb build has no source stamps");
    expect(unstamped).not.toContain("Source paths are relative");
  });

  it("names the plugin whose UI rendered the element", () => {
    expect(
      formatAnnotationContext({
        ...record,
        element: { ...record.element, pluginId: "notes" },
      }),
    ).toContain("**Rendered by plugin:** `notes`");
    expect(formatAnnotationContext(record)).not.toContain("Rendered by plugin");
  });

  it("rejects records with blank comments", () => {
    expect(
      annotationRecordSchema.safeParse({ ...record, comment: "   " }).success,
    ).toBe(false);
  });
});
