import type {
  BbPluginApi,
  PluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { registerHandlers, type TasksApiStore } from "../api";
import { readBrief } from "../brief/brief";
import { handlers as delegationHandlers } from "../delegate";
import { delegationRpcContract } from "../delegate/contract";
import { tasksRpcContract, type Project } from "../shared/contract";

export const TRACK_THREAD_TOOL = "tomato_track_thread";

const TITLE_MAX_CHARS = 60;
const PROJECT_LIMIT = 20;
const SUMMARY_MAX_CHARS = 90;
const EXAMPLE_LIMIT = 8;
const EXAMPLE_MAX_WORDS = 5;
const EXAMPLE_SCAN = 80;
const CLOSED_STATUSES = new Set<Project["status"]>(["done", "canceled"]);

export function shouldAutoTrack(
  store: TasksApiStore,
  context: PluginAgentConfigurationContext,
): boolean {
  if (context.origin.kind !== null) return false;
  if (context.thread.parentThreadId !== null) return false;
  if (context.thread.sourceThreadId !== null) return false;
  if (store.tasks.listTasksByThreadId(context.thread.id).length > 0) {
    return false;
  }
  return store.tasks.listProjectsByThreadId(context.thread.id).length === 0;
}

export function candidateProjects(
  store: TasksApiStore,
  bbProjectId: string,
): Project[] {
  const open = store.tasks
    .listProjects()
    .filter((project) => !CLOSED_STATUSES.has(project.status));
  const linked = open.filter(
    (project) => project.linkedBbProjectId === bbProjectId,
  );
  const unlinked = open.filter((project) => project.linkedBbProjectId === null);
  return [...linked, ...unlinked].slice(0, PROJECT_LIMIT);
}

function oneLine(text: string, max: number): string {
  const flat = text
    .replace(/[#*_`>[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function projectSummary(project: Project): string {
  const problem = readBrief(project.description).sections.problem;
  return oneLine(problem ?? project.description, SUMMARY_MAX_CHARS);
}

export function titleExamples(store: TasksApiStore): string[] {
  const examples: string[] = [];
  const seen = new Set<string>();
  for (const title of store.tasks.listRecentTaskTitles(EXAMPLE_SCAN)) {
    const trimmed = title.trim();
    const words = trimmed.split(/\s+/).length;
    if (words < 2 || words > EXAMPLE_MAX_WORDS) continue;
    if (/^\d/.test(trimmed)) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    examples.push(trimmed);
    if (examples.length === EXAMPLE_LIMIT) break;
  }
  return examples;
}

export function autoTrackInstructions(
  projects: readonly Project[],
  examples: readonly string[],
): string | null {
  if (projects.length === 0) return null;
  const list = projects
    .map((project) => {
      const summary = projectSummary(project);
      const name = JSON.stringify(oneLine(project.name, 60));
      return summary
        ? `- ${project.prefix} ${name}: ${summary}`
        : `- ${project.prefix} ${name}`;
    })
    .join("\n");
  const style =
    examples.length > 0
      ? ` Match the user's own titles: ${examples.map((title) => JSON.stringify(title)).join(", ")}.`
      : "";
  return [
    `This thread is not tracked in Tomato yet. Before you start on the user's first message, call ${TRACK_THREAD_TOOL} once with the project this work belongs to and a task title.`,
    `The title names the work in 2-5 words: sentence case, no project name, no trailing period.${style}`,
    `Pick the project from this list by what the work is about; if none clearly fits, do not call the tool:`,
    list,
  ].join("\n");
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function registerAutoTrack(bb: BbPluginApi, store: TasksApiStore): void {
  const tasks = registerHandlers(bb, store);
  const delegation = delegationHandlers(bb, store);

  bb.agents.registerTool({
    name: TRACK_THREAD_TOOL,
    description:
      "Create a Tomato task for the work in this thread and attach the thread to it.",
    presentation: {
      label: { pending: "Creating task", completed: "Created task" },
    },
    parameters: z
      .object({
        project: z
          .string()
          .describe(
            "Tomato project prefix such as ABC, from the listed projects",
          ),
        title: z
          .string()
          .max(TITLE_MAX_CHARS)
          .describe("Concise task title, 2-5 words"),
      })
      .strict(),
    async execute({ project: address, title }, ctx) {
      const existing = store.tasks.listTasksByThreadId(ctx.threadId)[0];
      if (existing) return `This thread is already tracked as ${existing.key}.`;
      const prefix = address.trim().toUpperCase();
      const project = store.tasks
        .listProjects()
        .find(
          (entry) => entry.prefix === prefix || entry.id === address.trim(),
        );
      if (!project) {
        return errorResult(
          `project not found: ${address}; pass one of the listed project prefixes`,
        );
      }
      const trimmed = title.trim().replace(/\.$/, "");
      if (!trimmed) return errorResult("title must not be blank");
      const created = await tasks.createTask(
        tasksRpcContract.createTask.input.parse({
          projectId: project.id,
          title: trimmed,
        }),
      );
      if (!created.ok) return errorResult(created.error.message);
      await delegation.taskThreadsAttach(
        delegationRpcContract.taskThreadsAttach.input.parse({
          taskId: created.task.id,
          threadId: ctx.threadId,
        }),
      );
      return `Tracked this thread as ${created.task.key} "${created.task.title}" in ${project.prefix}.`;
    },
  });
}
