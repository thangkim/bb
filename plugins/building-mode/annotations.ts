import { z } from "zod";

export const ANNOTATION_MENTION_PROVIDER_ID = "bb-ui-annotation";

const rectSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .strict();

const pageElementSchema = z
  .object({
    tagName: z.string().max(64),
    name: z.string().max(200),
    selector: z.string().max(2000),
    text: z.string().max(400),
    context: z.string().max(400),
    attributes: z.record(z.string(), z.string().max(400)),
    rect: rectSchema,
    sources: z.array(z.string().max(1000)).max(6),
    pluginId: z.string().min(1).max(200).nullable(),
  })
  .strict();

export const reactComponentSchema = z
  .object({
    name: z.string().min(1).max(200),
    source: z.string().max(1000).nullable(),
  })
  .strict();
export type ReactComponent = z.infer<typeof reactComponentSchema>;

export const pageAnnotationSchema = z
  .object({
    id: z.string().min(1).max(64),
    number: z.number().int().positive(),
    comment: z.string().trim().min(1).max(4000),
    url: z.string().max(4096),
    title: z.string().max(1024),
    viewport: z.object({ width: z.number(), height: z.number() }).strict(),
    element: pageElementSchema,
  })
  .strict();
export type PageAnnotation = z.infer<typeof pageAnnotationSchema>;

export const pageStateSchema = z
  .object({
    active: z.boolean(),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type PageState = z.infer<typeof pageStateSchema>;

export const annotationUpdateSchema = z
  .object({
    id: z.string().min(1).max(64),
    comment: z.string().trim().min(1).max(4000),
  })
  .strict();

export const pageMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("annotation-delete"),
      id: z.string().min(1).max(64),
    })
    .strict(),
  annotationUpdateSchema
    .extend({ type: z.literal("annotation-update") })
    .strict(),
  pageStateSchema.extend({ type: z.literal("state") }).strict(),
  z
    .object({
      type: z.literal("annotation"),
      annotation: pageAnnotationSchema,
    })
    .strict(),
]);

export const reactProbeSchema = z
  .object({ components: z.array(reactComponentSchema).max(12) })
  .strict()
  .nullable();

export const annotationRecordSchema = pageAnnotationSchema
  .extend({
    components: z.array(reactComponentSchema).max(12),
  })
  .strict();
export type AnnotationRecord = z.infer<typeof annotationRecordSchema>;

const SOURCE_ATTRIBUTE = "data-bb-src";

const ELEMENT_KINDS: Record<string, string> = {
  a: "link",
  button: "button",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  img: "image",
  input: "input",
  li: "list item",
  ol: "list",
  p: "paragraph",
  select: "select",
  svg: "icon",
  textarea: "text field",
  ul: "list",
};

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function formatComponent(component: ReactComponent): string {
  return component.source === null
    ? component.name
    : `${component.name} (\`${component.source}\`)`;
}

function routeOf(record: AnnotationRecord): string {
  try {
    const url = new URL(record.url);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return record.url;
  }
}

function summaryFor(
  record: AnnotationRecord,
  depth: number,
  length: number,
): string {
  const chain = record.components
    .slice(0, depth)
    .reverse()
    .map((component) => `<${component.name}>`)
    .join(" ");
  const kind = ELEMENT_KINDS[record.element.tagName] ?? record.element.tagName;
  const label = record.element.attributes["aria-label"] ?? record.element.text;
  return [
    chain,
    label.length > 0 ? `${kind}: "${truncate(label, length)}"` : kind,
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}

export function annotationMentionLabel(record: AnnotationRecord): string {
  return `${record.number}. ${summaryFor(record, 1, 32)}`.slice(0, 200);
}

function primarySource(record: AnnotationRecord): string | null {
  const own = record.element.attributes[SOURCE_ATTRIBUTE];
  if (own !== undefined && own.length > 0) return `\`${own}\``;
  const defined = record.components.filter(
    (component) => component.source !== null,
  );
  const [innermost] = defined;
  if (innermost !== undefined && innermost.source !== null) {
    const file = innermost.source.replace(/:\d+(?::\d+)?$/u, "");
    const outer = defined.find(
      (component) =>
        component.source !== null && !component.source.startsWith(file),
    );
    const inside =
      outer === undefined ? "" : `, inside ${formatComponent(outer)}`;
    return `${formatComponent(innermost)}${inside}`;
  }
  const [nearest] = record.element.sources;
  return nearest === undefined
    ? null
    : `\`${nearest}\` (nearest stamped ancestor)`;
}

export function formatAnnotationContext(record: AnnotationRecord): string {
  const { element } = record;
  const lines = [
    `## bb UI feedback: ${routeOf(record)}`,
    `**Viewport:** ${record.viewport.width}×${record.viewport.height}`,
    "",
    `### ${record.number}. ${summaryFor(record, 4, 40)}`,
    `**Location:** ${element.selector}`,
  ];
  const source = primarySource(record);
  lines.push(
    source === null
      ? "**Source:** not recorded; this bb build has no source stamps. Search for the classes, text, or component names below."
      : `**Source:** ${source}`,
  );
  if (element.pluginId !== null) {
    lines.push(
      `**Rendered by plugin:** \`${element.pluginId}\`; its UI source lives in that plugin, not in bb's app.`,
    );
  }
  if (element.sources.length > 0) {
    lines.push(
      `**Source trail:** ${element.sources.map((entry) => `\`${entry}\``).join(" › ")}`,
    );
  }
  if (record.components.length > 0) {
    lines.push(
      `**React:** ${record.components.map(formatComponent).join(" › ")}`,
    );
  }
  const classes = (element.attributes.class ?? "")
    .split(/\s+/u)
    .filter((name) => name.length > 0);
  if (classes.length > 0) {
    lines.push(
      `**Classes:** ${classes.slice(0, 12).join(", ")}${classes.length > 12 ? ", …" : ""}`,
    );
  }
  const attributes = Object.entries(element.attributes).filter(
    ([name]) => name !== "class" && name !== SOURCE_ATTRIBUTE,
  );
  if (attributes.length > 0) {
    lines.push(
      `**Attributes:** ${attributes.map(([name, value]) => `${name}=${JSON.stringify(value)}`).join(", ")}`,
    );
  }
  lines.push(
    `**Position:** ${element.rect.x}px, ${element.rect.y}px (${element.rect.width}×${element.rect.height}px)`,
  );
  const context = element.context.length > 0 ? element.context : element.text;
  if (context.length > 0) {
    lines.push(`**Context:** ${context}`);
  }
  lines.push(`**Feedback:** ${record.comment}`);
  if (
    element.sources.length > 0 ||
    record.components.some(
      (component) =>
        component.source !== null && !/^[a-z]+:\/\//u.test(component.source),
    )
  ) {
    lines.push(
      "",
      "_Source paths are relative to the repository root; line:column points at the JSX tag or component declaration._",
    );
  }
  return lines.join("\n");
}
