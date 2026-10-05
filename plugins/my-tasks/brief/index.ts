import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { publishProjectsChanged, type TasksApiStore } from "../api";
import { PRIORITIES, type Priority, type Project } from "../shared/contract";
import {
  applyBriefChanges,
  BriefError,
  formatBrief,
  type BriefChanges,
} from "./brief";

export const READ_BRIEF_TOOL = "my_tasks_project_brief";
export const UPDATE_BRIEF_TOOL = "my_tasks_update_project_brief";

const BRIEF_OUTPUT_MAX_CHARS = 20_000;
const INSTRUCTION_PROJECT_LIMIT = 5;

export function linkedProjects(
  store: TasksApiStore,
  threadId: string,
): Project[] {
  const projects = new Map<string, Project>();
  for (const project of store.tasks.listProjectsByThreadId(threadId)) {
    projects.set(project.id, project);
  }
  for (const task of store.tasks.listTasksByThreadId(threadId)) {
    if (projects.has(task.projectId)) continue;
    const project = store.tasks.getProject(task.projectId);
    if (project) projects.set(project.id, project);
  }
  return [...projects.values()];
}

export function resolveBriefProject(
  store: TasksApiStore,
  threadId: string | undefined,
  address: string | undefined,
): Project {
  const trimmed = address?.trim();
  if (trimmed) {
    const upper = trimmed.toUpperCase();
    const project = store.tasks
      .listProjects()
      .find((entry) => entry.id === trimmed || entry.prefix === upper);
    if (!project) {
      throw new BriefError(
        `project not found: ${trimmed}; pass a My Tasks project prefix such as ABC`,
      );
    }
    return project;
  }
  const linked = threadId ? linkedProjects(store, threadId) : [];
  if (linked.length === 1) return linked[0]!;
  if (linked.length === 0) {
    throw new BriefError(
      "this thread is not linked to a My Tasks project or task; pass project with the project prefix",
    );
  }
  throw new BriefError(
    `this thread is linked to several projects (${linked.map((project) => project.prefix).join(", ")}); pass project with one prefix`,
  );
}

export interface BriefUpdateResult {
  project: Project;
  changes: string[];
}

export function updateProjectBrief(
  bb: BbPluginApi,
  store: TasksApiStore,
  projectId: string,
  changes: BriefChanges,
  priority: Priority | undefined,
): BriefUpdateResult {
  const result = store.transaction(() => {
    const current = store.tasks.getProject(projectId);
    if (!current) throw new BriefError(`project not found: ${projectId}`);
    const update = applyBriefChanges(current.description, changes);
    const summary = [...update.changes];
    if (priority !== undefined && priority !== current.priority) {
      summary.push(`Set project priority to ${priority}`);
    }
    if (summary.length === 0) return { project: current, changes: summary };
    const project = store.tasks.updateProject(projectId, {
      description: update.description,
      ...(priority === undefined ? {} : { priority }),
    });
    return { project, changes: summary };
  });
  if (result.changes.length > 0) publishProjectsChanged(bb, result.project.id);
  return result;
}

function clip(text: string): string {
  return text.length <= BRIEF_OUTPUT_MAX_CHARS
    ? text
    : `${text.slice(0, BRIEF_OUTPUT_MAX_CHARS)}\n\n(truncated)`;
}

export function briefText(project: Project): string {
  return clip(
    `# ${project.prefix}: ${project.name}\n\nProject priority field: ${project.priority}\n\n${formatBrief(project.description)}`,
  );
}

function quoted(text: string): string {
  return JSON.stringify(text.replace(/\s+/g, " ").slice(0, 120));
}

export function briefInstructions(projects: readonly Project[]): string | null {
  if (projects.length === 0) return null;
  const shown = projects.slice(0, INSTRUCTION_PROJECT_LIMIT);
  const names = shown
    .map((project) => `${project.prefix} ${quoted(project.name)}`)
    .join(", ");
  const more =
    projects.length > shown.length
      ? ` and ${projects.length - shown.length} more`
      : "";
  return [
    `This thread is linked to My Tasks project ${names}${more}. The project's description holds its brief: Problem, Context, Priority, Solution, and Decisions.`,
    `When a decision made in this thread adds, changes, or drops any of those, ask the user once whether to update the project brief, naming the exact change. Call ${UPDATE_BRIEF_TOOL} only after the user agrees; never update the brief unasked.`,
  ].join(" ");
}

const sectionText = z
  .string()
  .nullable()
  .optional()
  .describe("New Markdown body for this section; null or empty removes the section");

const updateParameters = z
  .object({
    project: z
      .string()
      .optional()
      .describe(
        "My Tasks project prefix such as ABC; omit when the thread is linked to exactly one project",
      ),
    problem: sectionText,
    context: sectionText,
    priority: sectionText,
    solution: sectionText,
    projectPriority: z
      .enum(PRIORITIES)
      .optional()
      .describe("Also set the project's priority field"),
    addDecisions: z
      .array(z.string())
      .optional()
      .describe("New decisions, one sentence each"),
    removeDecisions: z
      .array(z.string())
      .optional()
      .describe(
        "Decisions to delete because they were dropped or reversed: the decision text, a unique part of it, or its number",
      ),
    replaceDecisions: z
      .array(z.object({ match: z.string(), text: z.string() }))
      .optional()
      .describe("Decisions to reword in place: match as in removeDecisions"),
  })
  .strict();

function errorResult(error: unknown) {
  if (error instanceof BriefError) {
    return { content: [{ type: "text" as const, text: error.message }], isError: true };
  }
  throw error;
}

export function registerProjectBrief(
  bb: BbPluginApi,
  store: TasksApiStore,
): void {
  bb.agents.registerTool({
    name: READ_BRIEF_TOOL,
    description:
      "Read a My Tasks project's brief: Problem, Context, Priority, Solution, and numbered Decisions.",
    presentation: {
      label: { pending: "Reading project brief", completed: "Read project brief" },
    },
    parameters: z
      .object({
        project: z
          .string()
          .optional()
          .describe(
            "My Tasks project prefix such as ABC; omit when the thread is linked to exactly one project",
          ),
      })
      .strict(),
    execute({ project }, ctx) {
      try {
        return briefText(resolveBriefProject(store, ctx.threadId, project));
      } catch (error) {
        return errorResult(error);
      }
    },
  });

  bb.agents.registerTool({
    name: UPDATE_BRIEF_TOOL,
    description:
      "Update a My Tasks project's brief one section or decision at a time. Only the fields you pass change; dropped decisions are deleted, not kept.",
    instructions: `When the user asks to "summarize thread into project" or "update project summary", read the brief with ${READ_BRIEF_TOOL}, compare it with the decisions made in this thread, then call ${UPDATE_BRIEF_TOOL} with only the changes: rewrite sections whose meaning changed, add new decisions, and delete decisions that were dropped or reversed. Tell the user what changed.`,
    presentation: {
      label: {
        pending: "Updating project brief",
        completed: "Updated project brief",
      },
    },
    parameters: updateParameters,
    execute(params, ctx) {
      try {
        const project = resolveBriefProject(store, ctx.threadId, params.project);
        const result = updateProjectBrief(
          bb,
          store,
          project.id,
          {
            sections: {
              problem: params.problem,
              context: params.context,
              priority: params.priority,
              solution: params.solution,
            },
            addDecisions: params.addDecisions,
            removeDecisions: params.removeDecisions,
            replaceDecisions: params.replaceDecisions,
          },
          params.projectPriority,
        );
        if (result.changes.length === 0) {
          return `No changes to the ${result.project.prefix} brief.`;
        }
        return `Updated the ${result.project.prefix} brief:\n${result.changes.map((line) => `- ${line}`).join("\n")}`;
      } catch (error) {
        return errorResult(error);
      }
    },
  });

  bb.agents.contributeInstructions(({ threadId }) =>
    briefInstructions(linkedProjects(store, threadId)),
  );
}
