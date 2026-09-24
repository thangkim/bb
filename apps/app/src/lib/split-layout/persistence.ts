import { z } from "zod";
import { MAX_PANES, countPanes, listPanes } from "./ops";
import { DEFAULT_COMPOSE_ID } from "./types";
import type { LayoutNode, PaneNode, SplitLayout, SplitNode } from "./types";

export const SPLIT_LAYOUT_SCHEMA_VERSION = 2;
export const SPLIT_LAYOUT_STORAGE_KEY = "bb.splitLayout";

const paneContentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("thread"),
      projectId: z.string().min(1),
      threadId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("new-thread"),
      composeId: z.string().min(1),
      seed: z
        .object({
          projectId: z.string().min(1),
          environmentId: z.string().min(1).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("plugin-panel"),
      pluginId: z.string().min(1),
      panelPath: z.string().min(1),
      subPath: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("plugin-detail"),
      pluginId: z.string().min(1),
    })
    .strict(),
]);

const paneNodeSchema: z.ZodType<PaneNode> = z
  .object({
    type: z.literal("pane"),
    paneId: z.string().min(1),
    content: paneContentSchema,
  })
  .strict();

const layoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.union([paneNodeSchema, splitNodeSchema]),
);

const splitNodeSchema: z.ZodType<SplitNode> = z
  .object({
    type: z.literal("split"),
    dir: z.enum(["row", "col"]),
    sizes: z.array(z.number().positive()),
    children: z.array(layoutNodeSchema).min(2),
  })
  .strict()
  .superRefine((split, context) => {
    if (split.sizes.length !== split.children.length) {
      context.addIssue({
        code: "custom",
        message: "Split sizes must match its child count",
        path: ["sizes"],
      });
    }
    const total = split.sizes.reduce((sum, size) => sum + size, 0);
    if (Math.abs(total - 1) > 1e-9) {
      context.addIssue({
        code: "custom",
        message: "Split sizes must sum to 1",
        path: ["sizes"],
      });
    }
  });

const splitLayoutSchema: z.ZodType<SplitLayout> = z
  .object({
    root: layoutNodeSchema,
    focusedPaneId: z.string().min(1),
  })
  .strict()
  .superRefine((layout, context) => {
    const panes = listPanes(layout.root);
    if (countPanes(layout.root) > MAX_PANES) {
      context.addIssue({
        code: "custom",
        message: `A split layout supports at most ${MAX_PANES} panes`,
        path: ["root"],
      });
    }
    if (!panes.some((pane) => pane.paneId === layout.focusedPaneId)) {
      context.addIssue({
        code: "custom",
        message: "The focused pane must exist",
        path: ["focusedPaneId"],
      });
    }
    if (new Set(panes.map((pane) => pane.paneId)).size !== panes.length) {
      context.addIssue({
        code: "custom",
        message: "Pane IDs must be unique",
        path: ["root"],
      });
    }
  });

const storedSplitLayoutSchema = z
  .object({
    version: z.literal(SPLIT_LAYOUT_SCHEMA_VERSION),
    layout: splitLayoutSchema,
  })
  .strict();

export function serializeSplitLayout(layout: SplitLayout): string {
  return JSON.stringify({ version: SPLIT_LAYOUT_SCHEMA_VERSION, layout });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addComposeIds(node: unknown): void {
  if (!isRecord(node)) return;
  if (node.type === "pane") {
    const content = node.content;
    if (
      isRecord(content) &&
      content.kind === "new-thread" &&
      content.composeId === undefined
    ) {
      content.composeId = DEFAULT_COMPOSE_ID;
    }
    return;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) addComposeIds(child);
  }
}

function migrateStoredSplitLayout(parsed: unknown): unknown {
  if (!isRecord(parsed) || parsed.version !== 1) return parsed;
  const layout = parsed.layout;
  if (isRecord(layout)) addComposeIds(layout.root);
  return { ...parsed, version: SPLIT_LAYOUT_SCHEMA_VERSION };
}

export function deserializeSplitLayout(
  storedValue: string | null,
): SplitLayout | null {
  if (storedValue === null) {
    return null;
  }
  try {
    const parsed: unknown = migrateStoredSplitLayout(JSON.parse(storedValue));
    const result = storedSplitLayoutSchema.safeParse(parsed);
    return result.success ? result.data.layout : null;
  } catch {
    return null;
  }
}
