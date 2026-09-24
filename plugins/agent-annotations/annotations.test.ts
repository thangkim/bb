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
  comment: "The pay button should be green and say “Pay securely” instead",
  url: "http://localhost:5173/checkout",
  title: "Checkout",
  viewport: { width: 1280, height: 720 },
  element: {
    tagName: "button",
    name: 'button#pay.btn "Pay now"',
    selector: "#pay",
    text: "Pay",
    attributes: { id: "pay", "aria-label": "Pay now" },
    rect: { x: 40, y: 300, width: 120, height: 36 },
    styles: { "background-color": "rgb(0, 0, 0)" },
    sources: [],
  },
  components: [
    { name: "SubmitButton", source: "src/SubmitButton.tsx:12" },
    { name: "CheckoutCard", source: null },
  ],
  surface: "browser",
};

describe("annotation formatting", () => {
  it("labels mentions with a stable element description", () => {
    expect(annotationMentionLabel(record)).toBe('2. button#pay.btn "Pay now"');
  });

  it("formats agent context with the comment, locator hints, and styles", () => {
    expect(formatAnnotationContext(record)).toBe(
      [
        "# Browser annotation 2",
        "",
        'The user selected an element on "Checkout" (http://localhost:5173/checkout) and commented on it.',
        "",
        "## Comment",
        "",
        "The pay button should be green and say “Pay securely” instead",
        "",
        "## Element",
        "",
        '- Element: `button#pay.btn "Pay now"`',
        "- Selector: `#pay`",
        "- React components, innermost first: SubmitButton (src/SubmitButton.tsx:12) › CheckoutCard",
        '- Text: "Pay"',
        '- Attributes: id="pay", aria-label="Pay now"',
        "- Box: x=40, y=300, 120×36px in a 1280×720px viewport",
        "",
        "## Computed styles",
        "",
        "- background-color: rgb(0, 0, 0)",
      ].join("\n"),
    );
  });

  it("frames bb app annotations and lists repository source locations", () => {
    const context = formatAnnotationContext({
      ...record,
      surface: "app",
      url: "http://localhost:5173/projects/proj_1/threads/thr_1",
      element: {
        ...record.element,
        sources: [
          "packages/shared-ui/src/components/ui/button.tsx:52:5",
          "apps/app/src/components/promptbox/PromptBoxInternal.tsx:412:7",
        ],
      },
      components: [{ name: "PromptBoxInternal", source: null }],
    });

    expect(context).toContain("# bb app annotation 2");
    expect(context).toContain(
      "The user selected an element in bb's own interface at http://localhost:5173/projects/proj_1/threads/thr_1 and commented on it.",
    );
    expect(context).toContain(
      "- Source, innermost first: `packages/shared-ui/src/components/ui/button.tsx:52:5` › `apps/app/src/components/promptbox/PromptBoxInternal.tsx:412:7`",
    );
    expect(context).toContain(
      "Source paths are relative to the repository root.",
    );
    expect(context).toContain(
      "- React components, innermost first: PromptBoxInternal",
    );
    expect(context).not.toContain("no source stamps");

    const unstamped = formatAnnotationContext({
      ...record,
      surface: "app",
      element: { ...record.element, sources: [] },
      components: [],
    });
    expect(unstamped).toContain("this bb build has no source stamps");
    expect(
      formatAnnotationContext({
        ...record,
        surface: "browser",
        components: [],
      }),
    ).not.toContain("no source stamps");
  });

  it("rejects records with blank comments", () => {
    expect(
      annotationRecordSchema.safeParse({ ...record, comment: "   " }).success,
    ).toBe(false);
  });
});
