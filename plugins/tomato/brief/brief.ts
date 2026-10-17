export const BRIEF_TEXT_SECTIONS = [
  "problem",
  "context",
  "priority",
  "solution",
] as const;

export type BriefTextSection = (typeof BRIEF_TEXT_SECTIONS)[number];
type BriefSection = BriefTextSection | "decisions";

const SECTION_ORDER: readonly BriefSection[] = [
  ...BRIEF_TEXT_SECTIONS,
  "decisions",
];

export const BRIEF_SECTION_TITLES: Record<BriefSection, string> = {
  problem: "Problem",
  context: "Context",
  priority: "Priority",
  solution: "Solution",
  decisions: "Decisions",
};

const SECTION_ALIASES: Record<BriefSection, readonly string[]> = {
  problem: ["problem", "problem statement", "problems"],
  context: ["context", "background"],
  priority: ["priority", "priorities"],
  solution: [
    "solution",
    "high-level solution",
    "high level solution",
    "approach",
  ],
  decisions: ["decisions", "key decisions", "decision log"],
};

export class BriefError extends Error {}

interface Block {
  heading: string;
  section: BriefSection | null;
  body: string;
}

interface ParsedBrief {
  preamble: string;
  blocks: Block[];
}

const HEADING = /^##\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const LIST_ITEM = /^\s{0,3}(?:[-*+]|\d+[.)])\s+(.*)$/;

function sectionFor(title: string): BriefSection | null {
  const normalized = title.trim().replace(/:$/, "").toLowerCase();
  for (const section of SECTION_ORDER) {
    if (SECTION_ALIASES[section].includes(normalized)) return section;
  }
  return null;
}

function parse(description: string): ParsedBrief {
  const preamble: string[] = [];
  const blocks: { heading: string; section: BriefSection | null; lines: string[] }[] = [];
  let inFence = false;
  for (const line of description.replace(/\r\n/g, "\n").split("\n")) {
    if (FENCE.test(line)) inFence = !inFence;
    const heading = inFence ? null : HEADING.exec(line);
    if (heading) {
      blocks.push({
        heading: line.trim(),
        section: sectionFor(heading[1]!),
        lines: [],
      });
      continue;
    }
    (blocks.at(-1)?.lines ?? preamble).push(line);
  }
  return {
    preamble: preamble.join("\n").trim(),
    blocks: blocks.map((block) => ({
      heading: block.heading,
      section: block.section,
      body: block.lines.join("\n").trim(),
    })),
  };
}

function render(brief: ParsedBrief): string {
  return [
    ...(brief.preamble === "" ? [] : [brief.preamble]),
    ...brief.blocks.map((block) =>
      block.body === "" ? block.heading : `${block.heading}\n\n${block.body}`,
    ),
  ].join("\n\n");
}

interface DecisionList {
  intro: string;
  items: string[];
}

function parseDecisions(body: string): DecisionList {
  const intro: string[] = [];
  const items: string[] = [];
  for (const line of body.split("\n")) {
    const item = LIST_ITEM.exec(line);
    if (item) {
      items.push(item[1]!.trim());
    } else if (items.length > 0 && line.trim() !== "" && /^\s/.test(line)) {
      items[items.length - 1] = `${items.at(-1)!} ${line.trim()}`;
    } else if (items.length === 0 && line.trim() !== "") {
      intro.push(line);
    }
  }
  return { intro: intro.join("\n").trim(), items };
}

function renderDecisions(list: DecisionList): string {
  return [
    ...(list.intro === "" ? [] : [list.intro]),
    ...(list.items.length === 0
      ? []
      : [list.items.map((item) => `- ${item}`).join("\n")]),
  ].join("\n\n");
}

export interface BriefView {
  sections: Record<BriefTextSection, string | null>;
  decisions: string[];
}

export function readBrief(description: string): BriefView {
  const brief = parse(description);
  const find = (section: BriefSection) =>
    brief.blocks.find((block) => block.section === section);
  const sections = Object.fromEntries(
    BRIEF_TEXT_SECTIONS.map((section) => {
      const body = find(section)?.body;
      return [section, body === undefined || body === "" ? null : body];
    }),
  ) as Record<BriefTextSection, string | null>;
  const decisions = find("decisions");
  return {
    sections,
    decisions: decisions ? parseDecisions(decisions.body).items : [],
  };
}

export interface BriefChanges {
  sections?: Partial<Record<BriefTextSection, string | null>>;
  addDecisions?: readonly string[];
  removeDecisions?: readonly string[];
  replaceDecisions?: readonly { match: string; text: string }[];
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function matchDecision(items: readonly string[], match: string): number {
  const needle = oneLine(match).toLowerCase();
  if (needle === "") throw new BriefError("decision match must not be empty");
  const exact = items.findIndex((item) => oneLine(item).toLowerCase() === needle);
  if (exact !== -1) return exact;
  const numbered = /^#?(\d+)$/.exec(needle);
  if (numbered) {
    const index = Number(numbered[1]) - 1;
    if (index >= 0 && index < items.length) return index;
  }
  const partial = items.flatMap((item, index) =>
    oneLine(item).toLowerCase().includes(needle) ? [index] : [],
  );
  if (partial.length === 1) return partial[0]!;
  if (partial.length === 0) {
    throw new BriefError(`no decision matches "${match}"`);
  }
  throw new BriefError(
    `"${match}" matches ${partial.length} decisions; quote more of the decision or pass its number`,
  );
}

function insertBlock(brief: ParsedBrief, block: Block): void {
  const rank = SECTION_ORDER.indexOf(block.section!);
  let after = -1;
  let before = -1;
  brief.blocks.forEach((existing, index) => {
    if (existing.section === null) return;
    const existingRank = SECTION_ORDER.indexOf(existing.section);
    if (existingRank < rank) after = index;
    else if (before === -1) before = index;
  });
  const at =
    after !== -1 ? after + 1 : before !== -1 ? before : brief.blocks.length;
  brief.blocks.splice(at, 0, block);
}

function setSection(
  brief: ParsedBrief,
  section: BriefSection,
  body: string,
): "set" | "removed" | "unchanged" {
  const index = brief.blocks.findIndex((block) => block.section === section);
  if (body === "") {
    if (index === -1) return "unchanged";
    brief.blocks.splice(index, 1);
    return "removed";
  }
  if (index === -1) {
    insertBlock(brief, {
      heading: `## ${BRIEF_SECTION_TITLES[section]}`,
      section,
      body,
    });
    return "set";
  }
  if (brief.blocks[index]!.body === body) return "unchanged";
  brief.blocks[index] = { ...brief.blocks[index]!, body };
  return "set";
}

export interface BriefUpdate {
  description: string;
  changes: string[];
}

export function applyBriefChanges(
  description: string,
  changes: BriefChanges,
): BriefUpdate {
  const brief = parse(description);
  const summary: string[] = [];

  for (const section of BRIEF_TEXT_SECTIONS) {
    const next = changes.sections?.[section];
    if (next === undefined) continue;
    const outcome = setSection(brief, section, (next ?? "").trim());
    if (outcome === "set") summary.push(`Updated ${BRIEF_SECTION_TITLES[section]}`);
    if (outcome === "removed") {
      summary.push(`Removed ${BRIEF_SECTION_TITLES[section]}`);
    }
  }

  const removals = changes.removeDecisions ?? [];
  const replacements = changes.replaceDecisions ?? [];
  const additions = (changes.addDecisions ?? [])
    .map(oneLine)
    .filter((text) => text !== "");
  if (removals.length + replacements.length + additions.length > 0) {
    const block = brief.blocks.find((entry) => entry.section === "decisions");
    const list = parseDecisions(block?.body ?? "");
    const removed = new Set<number>();
    for (const match of removals) {
      const index = matchDecision(list.items, match);
      removed.add(index);
    }
    const replaced = new Map<number, string>();
    for (const { match, text } of replacements) {
      const index = matchDecision(list.items, match);
      if (removed.has(index)) {
        throw new BriefError(
          `decision "${list.items[index]}" is both removed and replaced`,
        );
      }
      replaced.set(index, oneLine(text));
    }
    const items: string[] = [];
    list.items.forEach((item, index) => {
      if (removed.has(index)) {
        summary.push(`Removed decision: ${item}`);
        return;
      }
      const replacement = replaced.get(index);
      if (replacement === undefined) {
        items.push(item);
        return;
      }
      if (replacement === "") {
        summary.push(`Removed decision: ${item}`);
        return;
      }
      items.push(replacement);
      if (replacement !== item) summary.push(`Changed decision: ${replacement}`);
    });
    for (const text of additions) {
      const duplicate = items.some(
        (item) => oneLine(item).toLowerCase() === text.toLowerCase(),
      );
      if (duplicate) continue;
      items.push(text);
      summary.push(`Added decision: ${text}`);
    }
    setSection(brief, "decisions", renderDecisions({ intro: list.intro, items }));
  }

  return { description: render(brief), changes: summary };
}

export function formatBrief(description: string): string {
  const view = readBrief(description);
  const sections = BRIEF_TEXT_SECTIONS.map(
    (section) =>
      `## ${BRIEF_SECTION_TITLES[section]}\n\n${view.sections[section] ?? "(empty)"}`,
  );
  const decisions =
    view.decisions.length === 0
      ? "(none)"
      : view.decisions.map((item, index) => `${index + 1}. ${item}`).join("\n");
  return [...sections, `## Decisions\n\n${decisions}`].join("\n\n");
}
