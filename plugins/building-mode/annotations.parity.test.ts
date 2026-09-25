import { describe, expect, it } from "vitest";
import {
  annotationMentionLabel,
  formatAnnotationContext,
  type AnnotationRecord,
} from "./annotations.js";
import {
  annotationMentionLabel as legacyMentionLabel,
  formatAnnotationContext as legacyFormat,
  type AnnotationRecord as LegacyRecord,
} from "./fixtures/legacy-annotations.js";

const PLUGIN_LINE = /^\*\*Rendered by plugin:\*\* `[^`]+`$/u;

const base: AnnotationRecord = {
  id: "mfx12abc",
  number: 3,
  comment: "Make the collapse chevron match the section header height",
  url: "http://127.0.0.1:26846/projects/proj_1/threads/thr_1?pane=2#end",
  title: "bb",
  viewport: { width: 1440, height: 900 },
  element: {
    tagName: "button",
    name: 'button.flex "Collapse section"',
    selector:
      '[data-testid="sidebar"] > .section > button[aria-label="Collapse section"]',
    text: "Pinned",
    context: "Threads Pinned Today Yesterday",
    attributes: {
      class: "flex items-center gap-1 rounded-md px-2 py-1 text-sm",
      "aria-label": "Collapse section",
      type: "button",
      "data-testid": "section-toggle",
      "data-bb-src": "plugins/thread-list/components/SectionHeader.tsx:42:7",
    },
    rect: { x: 12, y: 184, width: 220, height: 28 },
    sources: [
      "plugins/thread-list/components/SectionHeader.tsx:42:7",
      "plugins/thread-list/components/ThreadListSidebar.tsx:120:5",
      "apps/app/src/components/plugin/PluginSlotMount.tsx:197:9",
    ],
    pluginId: "thread-list",
  },
  components: [
    {
      name: "SectionHeader",
      source: "plugins/thread-list/components/SectionHeader.tsx:30:8",
    },
    { name: "ContextMenuTrigger", source: null },
    {
      name: "ThreadListSidebar",
      source: "plugins/thread-list/components/ThreadListSidebar.tsx:88:8",
    },
  ],
};

function legacyRecord(record: AnnotationRecord): LegacyRecord {
  const { pluginId: _pluginId, ...element } = record.element;
  return { ...record, element, surface: "app" };
}

const variants: Array<[string, AnnotationRecord]> = [
  ["a stamped plugin element", base],
  [
    "an element without its own stamp",
    {
      ...base,
      element: {
        ...base.element,
        attributes: { class: "truncate", role: "button" },
      },
    },
  ],
  [
    "a component-only chain",
    {
      ...base,
      element: {
        ...base.element,
        attributes: {},
        sources: [],
        context: "",
        pluginId: null,
      },
    },
  ],
  [
    "an unstamped build",
    {
      ...base,
      element: { ...base.element, attributes: {}, sources: [] },
      components: [{ name: "SectionHeader", source: null }],
    },
  ],
  [
    "the nearest stamped ancestor",
    {
      ...base,
      element: { ...base.element, attributes: { class: "px-2" } },
      components: [],
    },
  ],
];

describe("context parity with the previous agent-annotations app surface", () => {
  it.each(variants)(
    "resolves %s to the previous context plus the plugin id",
    (_name, record) => {
      const current = formatAnnotationContext(record).split("\n");
      const previous = legacyFormat(legacyRecord(record)).split("\n");

      expect(current.filter((line) => !PLUGIN_LINE.test(line))).toEqual(
        previous,
      );
      expect(current.some((line) => PLUGIN_LINE.test(line))).toBe(
        record.element.pluginId !== null,
      );
      expect(annotationMentionLabel(record)).toBe(
        legacyMentionLabel(legacyRecord(record)),
      );
    },
  );

  it("carries every detail the previous context carried for a plugin element", () => {
    const context = formatAnnotationContext(base);

    for (const expected of [
      "## bb UI feedback: /projects/proj_1/threads/thr_1?pane=2#end",
      "**Viewport:** 1440×900",
      '### 3. <ThreadListSidebar> <ContextMenuTrigger> <SectionHeader> button: "Collapse section"',
      '**Location:** [data-testid="sidebar"] > .section > button[aria-label="Collapse section"]',
      "**Source:** `plugins/thread-list/components/SectionHeader.tsx:42:7`",
      "**Rendered by plugin:** `thread-list`",
      "**Source trail:** `plugins/thread-list/components/SectionHeader.tsx:42:7` › `plugins/thread-list/components/ThreadListSidebar.tsx:120:5` › `apps/app/src/components/plugin/PluginSlotMount.tsx:197:9`",
      "**React:** SectionHeader (`plugins/thread-list/components/SectionHeader.tsx:30:8`) › ContextMenuTrigger › ThreadListSidebar (`plugins/thread-list/components/ThreadListSidebar.tsx:88:8`)",
      "**Classes:** flex, items-center, gap-1, rounded-md, px-2, py-1, text-sm",
      '**Attributes:** aria-label="Collapse section", type="button", data-testid="section-toggle"',
      "**Position:** 12px, 184px (220×28px)",
      "**Context:** Threads Pinned Today Yesterday",
      "**Feedback:** Make the collapse chevron match the section header height",
    ]) {
      expect(context).toContain(expected);
    }
  });
});
