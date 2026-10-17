import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const TITLE_QUOTE_MAX_CHARS = 800;

export const TITLE_QUESTION_MAX_CHARS = 2000;

export const sideChatTitleHostContract = defineRpcContract({
  generateTitle: {
    input: z.object({ prompt: z.string().min(1) }).strict(),
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), text: z.string() }).strict(),
      z.object({ ok: z.literal(false), message: z.string() }).strict(),
    ]),
  },
});

export type GenerateTitleResult = z.infer<
  (typeof sideChatTitleHostContract)["generateTitle"]["output"]
>;

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

export function buildTitlePrompt(args: {
  quote: string | null;
  question: string;
}): string {
  const quote =
    args.quote === null
      ? ""
      : `The user is replying to this earlier message:\n<message>\n${clip(args.quote, TITLE_QUOTE_MAX_CHARS)}\n</message>\n\n`;
  return `${quote}The user asked:\n<question>\n${clip(args.question, TITLE_QUESTION_MAX_CHARS)}\n</question>\n\nWrite a concise 2 to 5 word title that says what the user is asking about, in the user's language. Use sentence case. Reply with the title only: no quotes, no trailing period, no explanation.`;
}

export function firstTitleLine(text: string): string | null {
  const line = text
    .split("\n")
    .map((candidate) => candidate.replace(/^#+\s*|^title:\s*/i, "").trim())
    .find((candidate) => candidate !== "");
  return line ?? null;
}
