import { resolve } from "node:path";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliContext,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

import {
  createComment,
  publishProjectsChanged,
  registerHandlers,
  type TasksApiStore,
} from "../api";
import {
  publishAttachmentChanged,
  readAttachmentContent,
  saveAttachmentFromBytes,
  type AttachmentOwner,
} from "../attachments";
import type { TasksStore } from "../db";
import { delegationRpcContract } from "../delegate/contract";
import { handlers as delegationHandlers } from "../delegate";
import { briefText, updateProjectBrief } from "../brief";
import { BRIEF_TEXT_SECTIONS } from "../brief/brief";
import {
  presetReasoningLevelSchema,
  tasksRpcContract,
  PRESET_PERMISSION_MODES,
  PRIORITIES,
  PROJECT_STATUSES,
  TASK_STATUSES,
  ULID_PATTERN,
  type Attachment,
  type Folder,
  type Label,
  type Project,
  type Preset,
  type SidebarProjectSummary,
  type Task,
  type TaskMutationResult,
} from "../shared/contract";
import { attachmentDownloadUrl } from "../shared/attachments";
import { errorMessage } from "../shared/errors";
import {
  TASK_SORTS,
  TASKS_PAGE_DEFAULT_LIMIT,
  TASKS_PAGE_MAX_LIMIT,
} from "../shared/pagination";
import { bytes, detail, oneLine, table } from "./format";
import { allocatePrefix } from "./prefix";
import { seedDemo } from "./seed";

const TASK_KEY_PATTERN = /^([A-Z][A-Z0-9]{0,9})-(\d+)$/;
const BB_PROJECT_ID_PATTERN = /^proj_[A-Za-z0-9_-]+$/;
const ACTIVE_THREAD_STATUSES = new Set(["starting", "working"]);
const DEFAULT_PROJECT_COLOR = "blue";
const DEFAULT_LABEL_COLOR = "gray";

const PRESET_SERVICE_TIERS = ["default", "fast", "none"] as const;
const PRESET_ENVIRONMENTS = ["project-default", "worktree"] as const;

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

const MACHINE_OPTION = {
  type: "string",
  placeholder: "id-or-name",
  description:
    "Enrolled machine that owns the file paths; defaults to the invoking thread's machine, otherwise the server's",
} as const;

const PROJECT_OPTION = {
  type: "string",
  placeholder: "prefix-or-id",
  description:
    "Tracker project prefix or id such as ABC, never a bb project id (proj_...); run bb my-tasks project list",
} as const;

const REQUIRED_PROJECT_OPTION = {
  ...PROJECT_OPTION,
  description: `${PROJECT_OPTION.description} (required)`,
} as const;

const KEY_POSITIONAL = {
  name: "key-or-id",
  description: "Task key such as ABC-12 (case-insensitive) or its ULID",
  required: true,
} as const;

interface PluginStatus {
  name: string;
  version: string;
}

type TasksDomain = ReturnType<typeof registerHandlers>;
type ListTasksInput = Parameters<TasksDomain["listTasks"]>[0];

class CliError extends PluginCliError {
  constructor(
    message: string,
    options?: { code?: string; hint?: string; exitCode?: number },
  ) {
    super(oneLine(message), options);
  }
}

function friendlyError(error: unknown): string {
  if (error instanceof PluginCliError) return error.message;
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const path = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue?.message ?? "invalid input"}`;
  }
  const message = errorMessage(error);
  if (message.includes("UNIQUE constraint failed: projects.prefix")) {
    return "project prefix is already in use";
  }
  if (
    message.includes("UNIQUE constraint failed: labels.project_id, labels.name")
  ) {
    return "label name is already in use in this project";
  }
  return message;
}

async function guard(
  action: () => Promise<string | PluginCliResult>,
): Promise<PluginCliResult> {
  try {
    const result = await action();
    return typeof result === "string"
      ? { exitCode: 0, stdout: result }
      : result;
  } catch (error) {
    if (error instanceof PluginCliError) throw error;
    throw new CliError(friendlyError(error));
  }
}

function normalizePrefix(value: string): string {
  return value.trim().toUpperCase();
}

function unwrapTask(result: TaskMutationResult): Task {
  if (!result.ok) throw new CliError(result.error.message);
  return result.task;
}

async function resolveClientHostId(
  bb: BbPluginApi,
  domain: TasksDomain,
  machine: string | undefined,
  ctx: PluginCliContext,
): Promise<string | undefined> {
  if (machine !== undefined) return resolveMachineId(domain, machine);
  if (!ctx.threadId) return undefined;
  const thread = await bb.sdk.threads.get({ threadId: ctx.threadId });
  if (!thread.environmentId) return undefined;
  const environment = await bb.sdk.environments.get({
    environmentId: thread.environmentId,
  });
  return environment.hostId;
}

function isMissingClientFileError(error: unknown): boolean {
  const message = errorMessage(error);
  return /\bENOENT\b|does not exist|not found|is a directory/i.test(message);
}

async function readClientFile(
  bb: BbPluginApi,
  hostId: string | undefined,
  path: string,
): Promise<{ bytes: Buffer; text: string | null }> {
  const file = await bb.sdk.files.read({
    ...(hostId ? { hostId } : {}),
    path,
  });
  return {
    bytes: Buffer.from(
      file.content,
      file.contentEncoding === "base64" ? "base64" : "utf8",
    ),
    text: file.contentEncoding === "utf8" ? file.content : null,
  };
}

async function readAttachmentSource(
  bb: BbPluginApi,
  hostId: string | undefined,
  path: string,
): Promise<Buffer> {
  try {
    return (await readClientFile(bb, hostId, path)).bytes;
  } catch (error) {
    if (isMissingClientFileError(error)) {
      throw new CliError(`attachment source is not a file: ${path}`, {
        code: "attachment_source_missing",
      });
    }
    throw error;
  }
}

async function writeClientFile(
  bb: BbPluginApi,
  hostId: string | undefined,
  path: string,
  content: Buffer,
): Promise<void> {
  await bb.sdk.files.write({
    ...(hostId ? { hostId } : {}),
    path,
    content: content.toString("base64"),
    contentEncoding: "base64",
    createParents: true,
  });
}

function attachmentFileName(path: string): string {
  return path.split(/[\\/]/).at(-1) || "attachment";
}

async function readTextOption(
  bb: BbPluginApi,
  ctx: PluginCliContext,
  hostId: string | undefined,
  inline: string | undefined,
  file: string | undefined,
): Promise<string | undefined> {
  if (file === undefined) return inline;
  const path = resolve(ctx.cwd ?? process.cwd(), file);
  try {
    const { text } = await readClientFile(bb, hostId, path);
    if (text === null) {
      throw new CliError(`could not read ${file}: file is not UTF-8 text`);
    }
    return text;
  } catch (error) {
    if (error instanceof PluginCliError) throw error;
    throw new CliError(`could not read ${file}: ${errorMessage(error)}`);
  }
}

function derivePrefix(name: string, projects: readonly Project[]): string {
  let base = name.toUpperCase().replace(/[^A-Z0-9]/gu, "");
  if (!base || !/^[A-Z]/u.test(base)) base = `P${base}`;
  base = base.slice(0, 10);
  const prefix = allocatePrefix(
    base,
    new Set(projects.map((project) => project.prefix)),
  );
  if (prefix === null) {
    throw new CliError(`could not derive a unique prefix from ${name}`);
  }
  return prefix;
}

async function listProjects(domain: TasksDomain): Promise<Project[]> {
  return tasksRpcContract.listProjects.output.parse(
    await domain.listProjects(tasksRpcContract.listProjects.input.parse({})),
  ).projects;
}

function bbProjectIdHint(
  address: string,
  projects: readonly Project[],
): string {
  const linked = projects.filter(
    (project) => project.linkedBbProjectId === address,
  );
  const first = linked[0];
  if (linked.length === 1 && first) {
    return `${address} is a bb project id; its tracker project is ${first.prefix} — re-run with --project ${first.prefix}`;
  }
  return `${address} is a bb project id, but --project takes a tracker project prefix or id; run bb my-tasks project list`;
}

async function resolveProject(
  domain: TasksDomain,
  address: string,
): Promise<Project> {
  const normalized = address.trim().toUpperCase();
  const projects = await listProjects(domain);
  const project = projects.find(
    (candidate) =>
      candidate.id === normalized || candidate.prefix === normalized,
  );
  if (!project) {
    const trimmed = address.trim();
    throw new CliError(`project not found: ${address}`, {
      code: "project_not_found",
      ...(BB_PROJECT_ID_PATTERN.test(trimmed)
        ? { hint: bbProjectIdHint(trimmed, projects) }
        : {}),
    });
  }
  return project;
}

async function defaultProject(
  domain: TasksDomain,
  ctx: PluginCliContext,
  required: boolean,
): Promise<Project | undefined> {
  if (!ctx.projectId) {
    if (required) {
      throw new CliError(
        "missing --project and no BB project context is available",
        { code: "missing_required" },
      );
    }
    return undefined;
  }
  const matches = (await listProjects(domain)).filter(
    (project) => project.linkedBbProjectId === ctx.projectId,
  );
  if (matches.length === 0) {
    throw new CliError(
      `no tracker project is linked to BB project ${ctx.projectId}; pass --project or link one with bb my-tasks project update`,
      { code: "project_not_linked" },
    );
  }
  if (matches.length > 1) {
    throw new CliError(
      `multiple tracker projects are linked to BB project ${ctx.projectId}; pass --project explicitly`,
      { code: "project_ambiguous" },
    );
  }
  return matches[0];
}

async function selectedProject(
  domain: TasksDomain,
  ctx: PluginCliContext,
  address: string | undefined,
  required: boolean,
): Promise<Project | undefined> {
  return address
    ? resolveProject(domain, address)
    : defaultProject(domain, ctx, required);
}

async function requiredProject(
  domain: TasksDomain,
  ctx: PluginCliContext,
  address: string | undefined,
): Promise<Project> {
  if (address) return resolveProject(domain, address);
  const linked = ctx.projectId
    ? (await listProjects(domain)).filter(
        (project) => project.linkedBbProjectId === ctx.projectId,
      )
    : [];
  const suggestion = linked.length === 1 ? linked[0] : undefined;
  throw new CliError("missing required option --project", {
    code: "missing_required",
    hint: suggestion
      ? `this thread's bb project ${ctx.projectId} is linked to tracker project ${suggestion.prefix}; re-run with --project ${suggestion.prefix}`
      : "pass a tracker project prefix or id; run bb my-tasks project list to see them",
  });
}

async function resolveFolder(
  domain: TasksDomain,
  address: string,
): Promise<Folder> {
  const folders = tasksRpcContract.listFolders.output.parse(
    await domain.listFolders(tasksRpcContract.listFolders.input.parse(null)),
  ).folders;
  const normalizedId = address.trim().toUpperCase();
  const byId = folders.find((folder) => folder.id === normalizedId);
  if (byId) return byId;
  const byName = folders.filter(
    (folder) => folder.name.toLowerCase() === address.trim().toLowerCase(),
  );
  if (byName.length === 0) {
    throw new CliError(`folder not found: ${address}`, {
      code: "folder_not_found",
    });
  }
  if (byName.length > 1) {
    throw new CliError(`folder name is ambiguous; use its id: ${address}`, {
      code: "folder_ambiguous",
    });
  }
  return byName[0]!;
}

async function resolveTask(
  domain: TasksDomain,
  address: string,
): Promise<Task> {
  const normalized = address.trim().toUpperCase();
  if (ULID_PATTERN.test(normalized)) {
    const result = tasksRpcContract.getTask.output.parse(
      await domain.getTask(
        tasksRpcContract.getTask.input.parse({ taskId: normalized }),
      ),
    );
    if (!result.task) throw taskNotFound(address);
    return result.task;
  }
  if (!TASK_KEY_PATTERN.test(normalized)) throw taskNotFound(address);
  const result = tasksRpcContract.getTaskByKey.output.parse(
    await domain.getTaskByKey(
      tasksRpcContract.getTaskByKey.input.parse({ taskKey: normalized }),
    ),
  );
  if (!result.task) throw taskNotFound(address);
  return result.task;
}

function taskNotFound(address: string): CliError {
  return new CliError(`task not found: ${address}`, { code: "task_not_found" });
}

async function listAllTasks(
  domain: TasksDomain,
  input: ListTasksInput,
): Promise<Task[]> {
  const tasks: Task[] = [];
  let cursor = input.cursor;
  do {
    const page = tasksRpcContract.listTasks.output.parse(
      await domain.listTasks(
        tasksRpcContract.listTasks.input.parse({
          ...input,
          limit: TASKS_PAGE_MAX_LIMIT,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      ),
    );
    tasks.push(...page.tasks);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return tasks;
}

function resolvePreset(presets: readonly Preset[], address: string): Preset {
  const normalized = address.trim().toLowerCase();
  const matches = presets.filter(
    (preset) =>
      preset.id.toLowerCase() === normalized ||
      preset.name.toLowerCase() === normalized,
  );
  if (matches.length === 0) {
    throw new CliError(`preset not found: ${address}`, {
      code: "preset_not_found",
    });
  }
  if (matches.length > 1) {
    throw new CliError(`preset name is ambiguous; use its id: ${address}`, {
      code: "preset_ambiguous",
    });
  }
  return matches[0]!;
}

const PROJECT_ATTACHMENT_OPTION = {
  type: "string",
  placeholder: "prefix-or-id",
  description: "Project prefix such as ABC or its ULID, instead of a task",
} as const;

async function resolveAttachmentOwner(
  domain: TasksDomain,
  store: TasksStore,
  ownerAddress: string | undefined,
  projectAddress: string | undefined,
): Promise<AttachmentOwner> {
  if (projectAddress !== undefined) {
    if (ownerAddress !== undefined) {
      throw new CliError(
        "pass either a task key, a comment id, or --project, not more than one",
        { code: "attachment_owner_conflict" },
      );
    }
    return { projectId: (await resolveProject(domain, projectAddress)).id };
  }
  if (ownerAddress === undefined) {
    throw new CliError("pass a task key, a comment id, or --project", {
      code: "attachment_owner_missing",
    });
  }
  const normalizedOwner = ownerAddress.trim().toUpperCase();
  if (!ULID_PATTERN.test(normalizedOwner)) {
    return { taskId: (await resolveTask(domain, ownerAddress)).id };
  }
  const comment = store.getComment(normalizedOwner);
  if (!comment) {
    throw new CliError(`comment not found: ${ownerAddress}`, {
      code: "comment_not_found",
    });
  }
  return { commentId: comment.id };
}

function attachmentTable(attachments: readonly Attachment[]): string {
  return table(
    ["ID", "NAME", "TYPE", "SIZE"],
    attachments.map((attachment) => [
      attachment.id,
      attachment.fileName,
      attachment.mime,
      bytes(attachment.sizeBytes),
    ]),
    "No attachments.",
  );
}

async function listTaskAttachments(
  domain: TasksDomain,
  taskId: string,
  comments: readonly { id: string }[],
): Promise<Attachment[]> {
  const attachments = [
    ...tasksRpcContract.listAttachments.output.parse(
      await domain.listAttachments(
        tasksRpcContract.listAttachments.input.parse({ taskId }),
      ),
    ).attachments,
  ];
  for (const comment of comments) {
    attachments.push(
      ...tasksRpcContract.listAttachments.output.parse(
        await domain.listAttachments(
          tasksRpcContract.listAttachments.input.parse({
            commentId: comment.id,
          }),
        ),
      ).attachments,
    );
  }
  return attachments;
}

async function listPresets(domain: TasksDomain): Promise<Preset[]> {
  return tasksRpcContract.listPresets.output.parse(
    await domain.listPresets(tasksRpcContract.listPresets.input.parse(null)),
  ).presets;
}

function presetEnvironmentLabel(preset: Preset): string {
  return preset.environmentKind === "new-worktree"
    ? "worktree"
    : "project-default";
}

function presetEnvironmentKind(
  value: (typeof PRESET_ENVIRONMENTS)[number] | undefined,
  fallback: Preset["environmentKind"],
): Preset["environmentKind"] {
  if (value === undefined) return fallback;
  return value === "worktree" ? "new-worktree" : "project-default";
}

function presetServiceTier(
  value: (typeof PRESET_SERVICE_TIERS)[number] | undefined,
): "default" | "fast" | null | undefined {
  if (value === undefined) return undefined;
  return value === "none" ? null : value;
}

async function resolveMachineId(
  domain: TasksDomain,
  address: string,
): Promise<string> {
  const machines = tasksRpcContract.listMachines.output.parse(
    await domain.listMachines(tasksRpcContract.listMachines.input.parse({})),
  ).machines;
  const normalized = address.trim().toLocaleLowerCase();
  const matches = machines.filter(
    (machine) =>
      machine.id === address.trim() ||
      machine.name.toLocaleLowerCase() === normalized,
  );
  if (matches.length === 0) {
    throw new CliError(`machine not found: ${address}`, {
      code: "machine_not_found",
    });
  }
  if (matches.length > 1) {
    throw new CliError(`machine name is ambiguous; use its id: ${address}`, {
      code: "machine_ambiguous",
    });
  }
  return matches[0]!.id;
}

function validatePresetTargetOptions(input: {
  environmentKind: Preset["environmentKind"];
  baseBranch: string | undefined;
  machine: string | undefined;
}): void {
  if (input.environmentKind === "new-worktree") return;
  if (input.baseBranch !== undefined) {
    throw new CliError("--base-branch requires --environment worktree");
  }
  if (input.machine !== undefined) {
    throw new CliError("--machine requires --environment worktree");
  }
}

async function projectLabels(
  domain: TasksDomain,
  projectId: string,
): Promise<Label[]> {
  return tasksRpcContract.listLabels.output.parse(
    await domain.listLabels(
      tasksRpcContract.listLabels.input.parse({ projectId }),
    ),
  ).labels;
}

function resolveLabel(labels: readonly Label[], address: string): Label {
  const normalizedId = address.trim().toUpperCase();
  const label = labels.find(
    (candidate) =>
      candidate.id === normalizedId ||
      candidate.name.toLowerCase() === address.trim().toLowerCase(),
  );
  if (!label) {
    throw new CliError(`label not found: ${address}`, {
      code: "label_not_found",
    });
  }
  return label;
}

async function projectSummaries(
  domain: TasksDomain,
): Promise<Map<string, SidebarProjectSummary>> {
  const { projects } = tasksRpcContract.sidebarSummary.output.parse(
    await domain.sidebarSummary(tasksRpcContract.sidebarSummary.input.parse(null)),
  );
  return new Map(projects.map((summary) => [summary.projectId, summary]));
}

function projectProgress(summary: SidebarProjectSummary | undefined): string {
  if (!summary || summary.taskCount === 0) return "0/0";
  const percent = Math.round((summary.doneTaskCount / summary.taskCount) * 100);
  return `${summary.doneTaskCount}/${summary.taskCount} (${percent}%)`;
}

function projectTable(
  projects: readonly Project[],
  folders: readonly Folder[],
  summaries: ReadonlyMap<string, SidebarProjectSummary>,
) {
  const folderNames = new Map(
    folders.map((folder) => [folder.id, folder.name]),
  );
  return table(
    [
      "PREFIX",
      "NAME",
      "STATUS",
      "PRIORITY",
      "DUE",
      "PROGRESS",
      "FOLDER",
      "BB PROJECT",
      "ID",
    ],
    projects.map((project) => [
      project.prefix,
      project.name,
      project.status,
      project.priority,
      project.dueDate ?? "-",
      projectProgress(summaries.get(project.id)),
      project.folderId
        ? (folderNames.get(project.folderId) ?? project.folderId)
        : "-",
      project.linkedBbProjectId ?? "-",
      project.id,
    ]),
    "No projects.",
  );
}

function taskAuthor(ctx: PluginCliContext): string {
  return ctx.threadId ? `agent (${ctx.threadId})` : "cli";
}

async function labelsForTaskList(
  domain: TasksDomain,
  projects: readonly Project[],
): Promise<Map<string, Label>> {
  const labels = new Map<string, Label>();
  for (const project of projects) {
    for (const label of await projectLabels(domain, project.id)) {
      labels.set(label.id, label);
    }
  }
  return labels;
}

function resolveInvokingThreadId(
  thread: string | undefined,
  ctx: PluginCliContext,
): string {
  const threadId = thread ?? process.env.BB_THREAD_ID ?? ctx.threadId;
  if (!threadId) {
    throw new CliError("missing --thread and BB_THREAD_ID is not set", {
      code: "missing_required",
    });
  }
  return threadId;
}

function groupCommand(
  group: string,
  summary: string,
  subcommands: readonly (readonly [string, string])[],
) {
  const width = Math.max(...subcommands.map(([name]) => name.length));
  return cliCommand({
    summary,
    hidden: true,
    description: [
      "Subcommands:",
      ...subcommands.map(
        ([name, text]) => `  bb my-tasks ${group} ${name.padEnd(width)}  ${text}`,
      ),
    ].join("\n"),
    positionals: [
      {
        name: "subcommand",
        description: `One of: ${subcommands.map(([name]) => name).join(", ")}`,
        variadic: true,
      },
    ],
    options: { json: JSON_OPTION },
    run(input) {
      const [subcommand] = input.positionals.subcommand;
      if (subcommand === undefined) return { exitCode: 1, stdout: input.help };
      throw new CliError(`unknown command: ${group} ${subcommand}`, {
        code: "unknown_command",
        hint: `run bb my-tasks ${group} --help for its subcommands`,
      });
    },
  });
}

export function registerTasksCli(
  bb: BbPluginApi,
  store: TasksApiStore,
  status: PluginStatus,
): void {
  const domain = registerHandlers(bb, store);
  bb.cli.register(
    defineCli({
      name: "my-tasks",
      summary:
        "Create and manage task-tracker projects, tasks, labels, and comments",
      description:
        "Tasks are addressed by key (ABC-12) or ULID. --project takes a tracker project prefix or id, never a bb project id (proj_...).",
      commands: {
        status: cliCommand({
          summary: "Show the My Tasks plugin name and version",
          description:
            "Plugin health only. Projects carry the workflow status (bb my-tasks project update <prefix> --status <status>); tasks are todo or done (bb my-tasks update <key-or-id> --status done).",
          options: { json: JSON_OPTION },
          run(input) {
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(status)
                : `${status.name} ${status.version}`,
            };
          },
        }),

        project: groupCommand(
          "project",
          "Create, list, show, or update tracker projects",
          [
            ["create", "Create a tracker project"],
            ["list", "List tracker projects"],
            ["show", "Show one tracker project"],
            ["update", "Change a project's status, priority, due date, or details"],
            ["move", "Move a project to a status column and position"],
            ["complete", "Mark a project and all of its open tasks done"],
            ["brief", "Show or update a project's brief and decisions"],
            ["dispatch", "Start a new agent thread for a whole project"],
            ["attach", "Attach an existing agent thread to a project"],
            ["detach", "Detach an agent thread from a project"],
            ["threads", "List agent threads attached to a project"],
            ["reorder-thread", "Change an attached thread's place in a project's thread list"],
          ],
        ),
        "project create": cliCommand({
          summary: "Create a tracker project",
          options: {
            name: {
              type: "string",
              required: true,
              description: "Human-readable project name",
            },
            prefix: {
              type: "string",
              placeholder: "PREFIX",
              description:
                "Task key prefix: uppercase letters and digits, starts with a letter, at most 10 characters (derived from --name when omitted)",
            },
            folder: {
              type: "string",
              placeholder: "id-or-name",
              description: "Folder that holds the project",
            },
            "link-bb-project": {
              type: "string",
              placeholder: "proj_id",
              aliases: ["bb-project", "link-project"],
              description:
                "bb project id (proj_...) whose threads track this tracker project",
            },
            color: {
              type: "string",
              default: DEFAULT_PROJECT_COLOR,
              description: "Accent color name",
            },
            status: {
              type: "enum",
              values: PROJECT_STATUSES,
              default: "todo",
              aliases: ["state"],
              description: "Workflow status",
            },
            priority: {
              type: "enum",
              values: PRIORITIES,
              default: "none",
              description: "Project priority",
            },
            due: {
              type: "string",
              placeholder: "YYYY-MM-DD",
              aliases: ["due-date"],
              description: "Due date as a calendar date, YYYY-MM-DD",
            },
            description: {
              type: "string",
              placeholder: "markdown",
              description: "Markdown description",
            },
            json: JSON_OPTION,
          },
          unexpectedPositionalHint:
            "the project name belongs in --name <name>.",
          run(input) {
            return guard(async () => {
              const name = input.options.name;
              const projects = await listProjects(domain);
              const folderAddress = input.options.folder;
              const folder = folderAddress
                ? await resolveFolder(domain, folderAddress)
                : undefined;
              const result = tasksRpcContract.createProject.output.parse(
                await domain.createProject(
                  tasksRpcContract.createProject.input.parse({
                    name,
                    prefix: input.options.prefix
                      ? normalizePrefix(input.options.prefix)
                      : derivePrefix(name, projects),
                    color: input.options.color,
                    folderId: folder?.id ?? null,
                    linkedBbProjectId: input.options["link-bb-project"] ?? null,
                    status: input.options.status,
                    priority: input.options.priority,
                    dueDate: input.options.due ?? null,
                    description: input.options.description ?? "",
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify(result)
                : `Created project ${result.project.prefix}  ${result.project.name}`;
            });
          },
        }),
        "project list": cliCommand({
          summary: "List tracker projects",
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const projects = await listProjects(domain);
              const folders = tasksRpcContract.listFolders.output.parse(
                await domain.listFolders(
                  tasksRpcContract.listFolders.input.parse(null),
                ),
              ).folders;
              const summaries = await projectSummaries(domain);
              return input.options.json
                ? JSON.stringify({
                    projects: projects.map((project) => {
                      const summary = summaries.get(project.id);
                      return {
                        ...project,
                        taskCount: summary?.taskCount ?? 0,
                        doneTaskCount: summary?.doneTaskCount ?? 0,
                      };
                    }),
                  })
                : projectTable(projects, folders, summaries);
            });
          },
        }),
        "project show": cliCommand({
          summary: "Show one tracker project",
          positionals: [
            {
              name: "prefix-or-id",
              description: "Tracker project prefix such as ABC, or its ULID",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const project = await resolveProject(
                domain,
                input.positionals["prefix-or-id"],
              );
              const folder = project.folderId
                ? await resolveFolder(domain, project.folderId)
                : null;
              const summary = (await projectSummaries(domain)).get(project.id);
              const tasks = await listAllTasks(
                domain,
                tasksRpcContract.listTasks.input.parse({
                  projectId: project.id,
                }),
              );
              if (input.options.json) {
                return JSON.stringify({ project, folder, tasks });
              }
              return [
                detail([
                ["Project", `${project.prefix} — ${project.name}`],
                ["ID", project.id],
                ["Status", project.status],
                ["Priority", project.priority],
                ["Due", project.dueDate ?? "-"],
                ["Progress", projectProgress(summary)],
                ["Color", project.color],
                ["Folder", folder?.name ?? "-"],
                ["BB project", project.linkedBbProjectId ?? "-"],
                ["Next task", `${project.prefix}-${project.nextTaskNumber}`],
                ["Created", project.createdAt],
                ]),
                `Description\n${project.description || "(none)"}`,
                `Tasks\n${table(
                  ["DONE", "KEY", "DUE", "TITLE"],
                  tasks.map((task) => [
                    task.status === "done" ? "x" : " ",
                    task.key,
                    task.dueDate ?? "-",
                    task.title,
                  ]),
                  "(none)",
                )}`,
              ].join("\n\n");
            });
          },
        }),
        "project update": cliCommand({
          summary:
            "Change a tracker project's status, priority, due date, description, name, color, folder, or bb link",
          positionals: [
            {
              name: "prefix-or-id",
              description: "Tracker project prefix such as ABC, or its ULID",
              required: true,
            },
          ],
          options: {
            name: { type: "string", description: "New project name" },
            color: { type: "string", description: "New accent color name" },
            folder: {
              type: "string",
              placeholder: "id-or-name",
              description: "Folder that holds the project",
            },
            "no-folder": {
              type: "boolean",
              description: "Move the project to the top level",
            },
            "link-bb-project": {
              type: "string",
              placeholder: "proj_id",
              aliases: ["bb-project", "link-project"],
              description: "bb project id (proj_...) to link",
            },
            "unlink-bb-project": {
              type: "boolean",
              description: "Remove the bb project link",
            },
            "rename-prefix": {
              type: "string",
              placeholder: "PREFIX",
              description:
                "New task key prefix; existing task keys are rewritten",
            },
            status: {
              type: "enum",
              values: PROJECT_STATUSES,
              aliases: ["state"],
              description: "New workflow status; the project moves to the end of that column",
            },
            priority: {
              type: "enum",
              values: PRIORITIES,
              description: "New priority",
            },
            due: {
              type: "string",
              placeholder: "YYYY-MM-DD",
              aliases: ["due-date"],
              description: "New due date as a calendar date, YYYY-MM-DD",
            },
            "no-due": { type: "boolean", description: "Clear the due date" },
            description: {
              type: "string",
              placeholder: "markdown",
              description: "Replacement markdown description",
            },
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "at-most-one", options: ["due", "no-due"] },
            { kind: "at-most-one", options: ["folder", "no-folder"] },
            {
              kind: "at-most-one",
              options: ["link-bb-project", "unlink-bb-project"],
            },
          ],
          run(input) {
            return guard(async () => {
              const project = await resolveProject(
                domain,
                input.positionals["prefix-or-id"],
              );
              const folderAddress = input.options.folder;
              const folder = folderAddress
                ? await resolveFolder(domain, folderAddress)
                : undefined;
              const changes = {
                name: input.options.name,
                color: input.options.color,
                folderId: input.options["no-folder"] ? null : folder?.id,
                linkedBbProjectId: input.options["unlink-bb-project"]
                  ? null
                  : input.options["link-bb-project"],
                status: input.options.status,
                priority: input.options.priority,
                dueDate: input.options["no-due"] ? null : input.options.due,
                description: input.options.description,
              };
              const renamePrefix = input.options["rename-prefix"];
              const hasFieldChanges = Object.values(changes).some(
                (value) => value !== undefined,
              );
              if (renamePrefix === undefined && !hasFieldChanges) {
                throw new CliError("no project changes were provided", {
                  code: "no_changes",
                });
              }
              const renameInput =
                renamePrefix === undefined
                  ? undefined
                  : tasksRpcContract.renameProjectPrefix.input.parse({
                      projectId: project.id,
                      prefix: normalizePrefix(renamePrefix),
                    });
              const updateInput = hasFieldChanges
                ? tasksRpcContract.updateProject.input.parse({
                    projectId: project.id,
                    ...changes,
                  })
                : undefined;
              if (
                renameInput &&
                store.projectPrefixExists(renameInput.prefix, project.id)
              ) {
                throw new CliError(
                  `Project prefix is already in use: ${renameInput.prefix}`,
                );
              }
              const updated = store.transaction(() =>
                store.tasks.updateProject(project.id, {
                  prefix: renameInput?.prefix,
                  name: updateInput?.name,
                  color: updateInput?.color,
                  folderId: updateInput?.folderId,
                  linkedBbProjectId: updateInput?.linkedBbProjectId,
                  status: updateInput?.status,
                  priority: updateInput?.priority,
                  dueDate: updateInput?.dueDate,
                  description: updateInput?.description,
                }),
              );
              publishProjectsChanged(bb, updated.id);
              return input.options.json
                ? JSON.stringify({ project: updated })
                : `Updated project ${updated.prefix}  ${updated.name}`;
            });
          },
        }),
        "project complete": cliCommand({
          summary: "Mark a tracker project done and finish every open task in it",
          positionals: [
            {
              name: "prefix-or-id",
              description: "Tracker project prefix such as ABC, or its ULID",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run(input, ctx) {
            return guard(async () => {
              const project = await resolveProject(
                domain,
                input.positionals["prefix-or-id"],
              );
              const result = tasksRpcContract.completeProject.output.parse(
                await domain.completeProject(
                  tasksRpcContract.completeProject.input.parse({
                    projectId: project.id,
                    authorName: taskAuthor(ctx),
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify(result)
                : `Completed project ${result.project.prefix} and ${result.completedTaskIds.length} open task(s)`;
            });
          },
        }),
        "project brief": cliCommand({
          summary:
            "Show a project's brief, or update its Problem, Context, Priority, Solution, and Decisions",
          positionals: [
            {
              name: "prefix-or-id",
              description: "Tracker project prefix such as ABC, or its ULID",
              required: true,
            },
          ],
          options: {
            problem: { type: "string", description: "New Problem section" },
            context: { type: "string", description: "New Context section" },
            "priority-note": {
              type: "string",
              description:
                "New Priority section; set the priority field with project update --priority",
            },
            solution: { type: "string", description: "New Solution section" },
            clear: {
              type: "enum",
              values: BRIEF_TEXT_SECTIONS,
              repeatable: true,
              split: ",",
              placeholder: "section",
              description: "Remove these sections; repeat or comma-separate",
            },
            "add-decision": {
              type: "string",
              repeatable: true,
              placeholder: "text",
              description: "Add a decision; repeat for several",
            },
            "remove-decision": {
              type: "string",
              repeatable: true,
              placeholder: "match",
              description:
                "Delete a decision by its text, a unique part of it, or its number; repeat for several",
            },
            json: JSON_OPTION,
          },
          run(input) {
            return guard(async () => {
              const project = await resolveProject(
                domain,
                input.positionals["prefix-or-id"],
              );
              const options = input.options;
              const cleared = new Set(options.clear ?? []);
              const sections = {
                problem: cleared.has("problem") ? null : options.problem,
                context: cleared.has("context") ? null : options.context,
                priority: cleared.has("priority")
                  ? null
                  : options["priority-note"],
                solution: cleared.has("solution") ? null : options.solution,
              };
              const addDecisions = options["add-decision"] ?? [];
              const removeDecisions = options["remove-decision"] ?? [];
              const updating =
                Object.values(sections).some((value) => value !== undefined) ||
                addDecisions.length + removeDecisions.length > 0;
              if (!updating) {
                return options.json
                  ? JSON.stringify({ project })
                  : briefText(project);
              }
              const result = updateProjectBrief(
                bb,
                store,
                project.id,
                { sections, addDecisions, removeDecisions },
                undefined,
              );
              if (options.json) return JSON.stringify(result);
              return result.changes.length === 0
                ? `No changes to the ${result.project.prefix} brief`
                : [
                    `Updated the ${result.project.prefix} brief:`,
                    ...result.changes.map((line) => `- ${line}`),
                  ].join("\n");
            });
          },
        }),
        "project move": cliCommand({
          summary: "Move a project to a status column, optionally between two neighbors",
          positionals: [
            {
              name: "prefix-or-id",
              description: "Tracker project prefix such as ABC, or its ULID",
              required: true,
            },
          ],
          options: {
            status: {
              type: "enum",
              values: PROJECT_STATUSES,
              required: true,
              aliases: ["state"],
              description: "Destination workflow status",
            },
            after: {
              type: "string",
              placeholder: "prefix-or-id",
              description: "Place directly after this project in the destination column",
            },
            before: {
              type: "string",
              placeholder: "prefix-or-id",
              description: "Place directly before this project in the destination column",
            },
            json: JSON_OPTION,
          },
          run(input) {
            return guard(async () => {
              const project = await resolveProject(
                domain,
                input.positionals["prefix-or-id"],
              );
              const after = input.options.after
                ? await resolveProject(domain, input.options.after)
                : null;
              const before = input.options.before
                ? await resolveProject(domain, input.options.before)
                : null;
              const { project: moved } = tasksRpcContract.moveProject.output.parse(
                await domain.moveProject(
                  tasksRpcContract.moveProject.input.parse({
                    projectId: project.id,
                    status: input.options.status,
                    beforeProjectId: after?.id ?? null,
                    afterProjectId: before?.id ?? null,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify({ project: moved })
                : `Moved project ${moved.prefix} to ${moved.status}`;
            });
          },
        }),

        "project dispatch": cliCommand({
          summary: "Start a new agent thread for a whole project",
          positionals: [
            {
              name: "prefix-or-id",
              description: "Tracker project prefix such as ABC, or its ULID",
              required: true,
            },
          ],
          options: {
            preset: {
              type: "string",
              required: true,
              placeholder: "name-or-id",
              description:
                "Dispatch preset name or id; run bb my-tasks preset list to see them",
            },
            instructions: {
              type: "string",
              placeholder: "text",
              aliases: ["extra-instructions"],
              description: "Extra instructions for this dispatch only",
            },
            json: JSON_OPTION,
          },
          run(input) {
            return guard(async () => {
              const project = await resolveProject(
                domain,
                input.positionals["prefix-or-id"],
              );
              const preset = resolvePreset(
                await listPresets(domain),
                input.options.preset,
              );
              const result =
                delegationRpcContract.delegateProject.output.parse(
                  await delegationHandlers(bb, store).delegateProject(
                    delegationRpcContract.delegateProject.input.parse({
                      projectId: project.id,
                      presetId: preset.id,
                      extraInstructions: input.options.instructions,
                    }),
                  ),
                );
              return input.options.json
                ? JSON.stringify({ project, preset, ...result })
                : result.threadId;
            });
          },
        }),

        "project attach": cliCommand({
          summary: "Attach an existing agent thread to a project",
          positionals: [
            {
              name: "prefix-or-id",
              description: "Tracker project prefix such as ABC, or its ULID",
              required: true,
            },
          ],
          options: {
            thread: {
              type: "string",
              placeholder: "thread-id",
              aliases: ["thread-id"],
              description:
                "Thread to attach; defaults to BB_THREAD_ID or the invoking thread",
            },
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              const project = await resolveProject(
                domain,
                input.positionals["prefix-or-id"],
              );
              const threadId = resolveInvokingThreadId(
                input.options.thread,
                ctx,
              );
              const result =
                delegationRpcContract.projectThreadsAttach.output.parse(
                  await delegationHandlers(bb, store).projectThreadsAttach(
                    delegationRpcContract.projectThreadsAttach.input.parse({
                      projectId: project.id,
                      threadId,
                    }),
                  ),
                );
              return input.options.json
                ? JSON.stringify({ project, ...result })
                : `Attached ${result.threadId} to ${project.prefix}`;
            });
          },
        }),

        "project detach": cliCommand({
          summary: "Detach an agent thread from a project",
          positionals: [
            {
              name: "prefix-or-id",
              description: "Tracker project prefix such as ABC, or its ULID",
              required: true,
            },
          ],
          options: {
            thread: {
              type: "string",
              placeholder: "thread-id",
              aliases: ["thread-id"],
              description:
                "Thread to detach; defaults to BB_THREAD_ID or the invoking thread",
            },
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              const project = await resolveProject(
                domain,
                input.positionals["prefix-or-id"],
              );
              const threadId = resolveInvokingThreadId(
                input.options.thread,
                ctx,
              );
              const result =
                delegationRpcContract.projectThreadsDetach.output.parse(
                  await delegationHandlers(bb, store).projectThreadsDetach(
                    delegationRpcContract.projectThreadsDetach.input.parse({
                      projectId: project.id,
                      threadId,
                    }),
                  ),
                );
              return input.options.json
                ? JSON.stringify({ project, ...result })
                : `Detached ${result.threadId} from ${project.prefix}`;
            });
          },
        }),

        "project threads": cliCommand({
          summary: "List agent threads attached to a project",
          positionals: [
            {
              name: "prefix-or-id",
              description: "Tracker project prefix such as ABC, or its ULID",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const project = await resolveProject(
                domain,
                input.positionals["prefix-or-id"],
              );
              const result = tasksRpcContract.listProjectThreads.output.parse(
                await domain.listProjectThreads(
                  tasksRpcContract.listProjectThreads.input.parse({
                    projectId: project.id,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify({ project, projectThreads: result.projectThreads })
                : table(
                    ["THREAD", "TITLE", "ATTACHED"],
                    result.projectThreads.map((thread) => [
                      thread.threadId,
                      thread.title,
                      thread.attachedAt,
                    ]),
                    "No attached threads.",
                  );
            });
          },
        }),

        "project reorder-thread": cliCommand({
          summary: "Change an attached thread's place in a project's thread list",
          description:
            "Pass --after or --before another thread attached to the same project. With neither, the thread moves to the end of the list.",
          positionals: [
            {
              name: "prefix-or-id",
              description: "Tracker project prefix such as ABC, or its ULID",
              required: true,
            },
          ],
          options: {
            thread: {
              type: "string",
              placeholder: "thread-id",
              aliases: ["thread-id"],
              description:
                "Thread to move; defaults to BB_THREAD_ID or the invoking thread",
            },
            after: {
              type: "string",
              placeholder: "thread-id",
              description: "Place directly after this attached thread",
            },
            before: {
              type: "string",
              placeholder: "thread-id",
              description: "Place directly before this attached thread",
            },
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              const project = await resolveProject(
                domain,
                input.positionals["prefix-or-id"],
              );
              const threadId = resolveInvokingThreadId(
                input.options.thread,
                ctx,
              );
              const { projectThread } =
                tasksRpcContract.reorderProjectThread.output.parse(
                  await domain.reorderProjectThread(
                    tasksRpcContract.reorderProjectThread.input.parse({
                      projectId: project.id,
                      threadId,
                      beforeThreadId: input.options.after ?? null,
                      afterThreadId: input.options.before ?? null,
                    }),
                  ),
                );
              return input.options.json
                ? JSON.stringify({ project, projectThread })
                : `Reordered ${projectThread.threadId} in ${project.prefix}`;
            });
          },
        }),

        folder: groupCommand(
          "folder",
          "Create, list, update, or delete project folders",
          [
            ["create", "Create a folder"],
            ["list", "List folders"],
            ["update", "Rename or move a folder"],
            ["delete", "Delete a folder, keeping its contents"],
          ],
        ),
        "folder create": cliCommand({
          summary: "Create a project folder",
          options: {
            name: {
              type: "string",
              required: true,
              description: "Folder name",
            },
            parent: {
              type: "string",
              placeholder: "id-or-name",
              description: "Parent folder id or name",
            },
            json: JSON_OPTION,
          },
          unexpectedPositionalHint: "the folder name belongs in --name <name>.",
          run(input) {
            return guard(async () => {
              const parentAddress = input.options.parent;
              const parent = parentAddress
                ? await resolveFolder(domain, parentAddress)
                : undefined;
              const result = tasksRpcContract.createFolder.output.parse(
                await domain.createFolder(
                  tasksRpcContract.createFolder.input.parse({
                    name: input.options.name,
                    parentFolderId: parent?.id ?? null,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify(result)
                : `Created folder ${result.folder.name}  ${result.folder.id}`;
            });
          },
        }),
        "folder list": cliCommand({
          summary: "List project folders",
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const result = tasksRpcContract.listFolders.output.parse(
                await domain.listFolders(
                  tasksRpcContract.listFolders.input.parse(null),
                ),
              );
              const names = new Map(
                result.folders.map((folder) => [folder.id, folder.name]),
              );
              return input.options.json
                ? JSON.stringify(result)
                : table(
                    ["NAME", "PARENT", "ID"],
                    result.folders.map((folder) => [
                      folder.name,
                      folder.parentFolderId
                        ? (names.get(folder.parentFolderId) ??
                          folder.parentFolderId)
                        : "-",
                      folder.id,
                    ]),
                    "No folders.",
                  );
            });
          },
        }),
        "folder update": cliCommand({
          summary: "Rename or move a project folder",
          positionals: [
            {
              name: "id-or-name",
              description: "Folder id or its unique name",
              required: true,
            },
          ],
          options: {
            name: { type: "string", description: "New folder name" },
            parent: {
              type: "string",
              placeholder: "id-or-name",
              description: "New parent folder id or name",
            },
            "no-parent": {
              type: "boolean",
              description: "Move the folder to the top level",
            },
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "at-most-one", options: ["parent", "no-parent"] },
          ],
          run(input) {
            return guard(async () => {
              const folder = await resolveFolder(
                domain,
                input.positionals["id-or-name"],
              );
              const parentAddress = input.options.parent;
              const noParent = input.options["no-parent"];
              const name = input.options.name;
              if (
                name === undefined &&
                parentAddress === undefined &&
                !noParent
              ) {
                throw new CliError("no folder changes were provided", {
                  code: "no_changes",
                });
              }
              const parent = parentAddress
                ? await resolveFolder(domain, parentAddress)
                : null;
              const renameInput =
                name === undefined
                  ? undefined
                  : tasksRpcContract.renameFolder.input.parse({
                      folderId: folder.id,
                      name,
                    });
              const moveInput =
                parentAddress === undefined && !noParent
                  ? undefined
                  : tasksRpcContract.moveFolder.input.parse({
                      folderId: folder.id,
                      parentFolderId: parent?.id ?? null,
                    });
              const updated = store.transaction(() =>
                store.tasks.updateFolder(folder.id, {
                  name: renameInput?.name,
                  parentFolderId: moveInput?.parentFolderId,
                }),
              );
              publishProjectsChanged(bb, null);
              return input.options.json
                ? JSON.stringify({ folder: updated })
                : `Updated folder ${updated.name}  ${updated.id}`;
            });
          },
        }),
        "folder delete": cliCommand({
          summary: "Delete a folder and unfile its contents",
          description:
            "Deleting a folder moves its projects and subfolders to the top level. No tasks are deleted.",
          positionals: [
            {
              name: "id-or-name",
              description: "Folder id or its unique name",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const address = input.positionals["id-or-name"];
              const folder = await resolveFolder(domain, address);
              const result = tasksRpcContract.deleteFolder.output.parse(
                await domain.deleteFolder(
                  tasksRpcContract.deleteFolder.input.parse({
                    folderId: folder.id,
                  }),
                ),
              );
              if (!result.deleted) {
                throw new CliError(
                  `folder not found: ${address} (it was deleted by another client)`,
                  { code: "folder_not_found" },
                );
              }
              if (input.options.json) {
                return JSON.stringify({ ...result, folder });
              }
              const projectCount = result.movedProjectIds.length;
              const folderCount = result.movedFolderIds.length;
              const moved = [
                projectCount > 0
                  ? `${projectCount} project${projectCount > 1 ? "s" : ""}`
                  : null,
                folderCount > 0
                  ? `${folderCount} subfolder${folderCount > 1 ? "s" : ""}`
                  : null,
              ].filter((part) => part !== null);
              return moved.length === 0
                ? `Deleted folder ${folder.name}`
                : `Deleted folder ${folder.name}; ${moved.join(" and ")} moved to the top level. No tasks were deleted.`;
            });
          },
        }),

        create: cliCommand({
          summary: "Create a task",
          unexpectedPositionalHint:
            "the task title belongs in --title <title>.",
          options: {
            project: PROJECT_OPTION,
            title: {
              type: "string",
              required: true,
              aliases: ["name", "subject"],
              description: "Task title",
            },
            description: {
              type: "string",
              placeholder: "markdown",
              aliases: ["body", "details", "text", "content"],
              description:
                "Markdown description; use --description-file for long text",
            },
            "description-file": {
              type: "string",
              placeholder: "path",
              description:
                "Read the description from this UTF-8 file on the invoking machine",
            },
            priority: {
              type: "enum",
              values: PRIORITIES,
              default: "none",
              description: "Task priority",
            },
            label: {
              type: "string",
              repeatable: true,
              split: ",",
              placeholder: "name",
              aliases: ["labels"],
              description:
                "Existing label name; repeat the flag or pass a comma-separated list",
            },
            due: {
              type: "string",
              placeholder: "YYYY-MM-DD",
              aliases: ["due-date"],
              description: "Due date as a calendar date, YYYY-MM-DD",
            },
            attach: {
              type: "string",
              repeatable: true,
              placeholder: "path",
              aliases: ["file", "attachment"],
              description:
                "File to attach, repeatable; read from the invoking machine, at most 25 MB each",
            },
            machine: MACHINE_OPTION,
            json: JSON_OPTION,
          },
          constraints: [
            {
              kind: "at-most-one",
              options: ["description", "description-file"],
            },
          ],
          run(input, ctx) {
            return guard(async () => {
              const attachPaths = input.options.attach.map((path) =>
                resolve(ctx.cwd ?? process.cwd(), path),
              );
              const descriptionFile = input.options["description-file"];
              const usesClientFiles =
                attachPaths.length > 0 || descriptionFile !== undefined;
              if (input.options.machine !== undefined && !usesClientFiles) {
                throw new CliError(
                  "--machine requires --attach or --description-file",
                );
              }
              const clientHostId = usesClientFiles
                ? await resolveClientHostId(
                    bb,
                    domain,
                    input.options.machine,
                    ctx,
                  )
                : undefined;
              const attachSources: Array<{ path: string; bytes: Buffer }> = [];
              for (const path of attachPaths) {
                attachSources.push({
                  path,
                  bytes: await readAttachmentSource(bb, clientHostId, path),
                });
              }
              const project = await selectedProject(
                domain,
                ctx,
                input.options.project,
                true,
              );
              if (!project) throw new CliError("project is required");
              const labels = await projectLabels(domain, project.id);
              const labelIds = input.options.label.map(
                (name) => resolveLabel(labels, name).id,
              );
              const created = tasksRpcContract.createTask.input.parse({
                projectId: project.id,
                title: input.options.title,
                description:
                  (await readTextOption(
                    bb,
                    ctx,
                    clientHostId,
                    input.options.description,
                    descriptionFile,
                  )) ?? "",
                priority: input.options.priority,
                dueDate: input.options.due ?? null,
                labelIds,
              });
              const task = unwrapTask(
                tasksRpcContract.createTask.output.parse(
                  await domain.createTask(created),
                ),
              );
              const attachments: Attachment[] = [];
              const failedAttachments: Array<{ path: string; error: string }> =
                [];
              for (const source of attachSources) {
                try {
                  const attachment = await saveAttachmentFromBytes(
                    store.tasks,
                    source.bytes,
                    {
                      taskId: task.id,
                      fileName: attachmentFileName(source.path),
                    },
                  );
                  publishAttachmentChanged(bb, store.tasks, attachment);
                  attachments.push(attachment);
                } catch (error) {
                  failedAttachments.push({
                    path: source.path,
                    error: errorMessage(error),
                  });
                }
              }
              const stdout = input.options.json
                ? JSON.stringify({ task, attachments, failedAttachments })
                : [
                    `Created ${task.key}  ${task.title}`,
                    ...attachments.map(
                      (attachment) =>
                        `Attached ${attachment.fileName}  ${attachment.id}`,
                    ),
                    ...failedAttachments.map(
                      (entry) =>
                        `Failed to attach ${entry.path}: ${entry.error}`,
                    ),
                    ...failedAttachments.map(
                      (entry) =>
                        `Retry with: bb my-tasks attachment add ${task.key} --file ${entry.path}`,
                    ),
                  ].join("\n");
              if (failedAttachments.length === 0) return stdout;
              return {
                exitCode: 1,
                stdout,
                stderr: `created ${task.key}, but ${failedAttachments.length} of ${attachPaths.length} attachments failed; see stdout for per-file recovery commands`,
              };
            });
          },
        }),

        list: cliCommand({
          summary: "List and filter tasks",
          options: {
            project: PROJECT_OPTION,
            status: {
              type: "enum",
              values: TASK_STATUSES,
              repeatable: true,
              split: ",",
              aliases: ["statuses", "state"],
              description:
                "Keep only todo (not done) or done tasks; repeat the flag or pass a comma-separated list",
            },
            priority: {
              type: "enum",
              values: PRIORITIES,
              repeatable: true,
              split: ",",
              aliases: ["priorities"],
              description:
                "Keep only these priorities; repeat the flag or pass a comma-separated list",
            },
            label: {
              type: "string",
              repeatable: true,
              split: ",",
              placeholder: "name",
              aliases: ["labels"],
              description:
                "Keep only tasks carrying these label names; repeat or comma-separate",
            },
            active: {
              type: "boolean",
              description: "Keep only tasks with a live agent thread",
            },
            search: {
              type: "string",
              placeholder: "query",
              aliases: ["query", "q"],
              description: "Match title and description text",
            },
            sort: {
              type: "enum",
              values: TASK_SORTS,
              default: "manual",
              description: "Row order",
            },
            limit: {
              type: "integer",
              min: 1,
              max: TASKS_PAGE_MAX_LIMIT,
              default: TASKS_PAGE_DEFAULT_LIMIT,
              description: "Rows per page",
            },
            cursor: {
              type: "string",
              placeholder: "opaque",
              description:
                "Continue from a previous page's nextCursor with identical filters",
            },
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              const project = await selectedProject(
                domain,
                ctx,
                input.options.project,
                false,
              );
              const projects = project ? [project] : await listProjects(domain);
              const labelById = await labelsForTaskList(domain, projects);
              const labelIds = input.options.label.map((name) => {
                const matches = [...labelById.values()].filter(
                  (label) =>
                    label.name.toLowerCase() === name.trim().toLowerCase(),
                );
                if (matches.length === 0) {
                  throw new CliError(`label not found: ${name}`, {
                    code: "label_not_found",
                  });
                }
                if (matches.length > 1 && !project) {
                  throw new CliError(
                    `label name exists in multiple projects; pass --project: ${name}`,
                    { code: "label_ambiguous" },
                  );
                }
                return matches[0]!.id;
              });
              const limit = input.options.limit;
              const result = tasksRpcContract.listTasks.output.parse(
                await domain.listTasks(
                  tasksRpcContract.listTasks.input.parse({
                    projectId: project?.id,
                    statuses:
                      input.options.status.length > 0
                        ? input.options.status
                        : undefined,
                    priorities:
                      input.options.priority.length > 0
                        ? input.options.priority
                        : undefined,
                    labelIds: labelIds.length > 0 ? labelIds : undefined,
                    activeOnly: input.options.active,
                    search: input.options.search,
                    sort: input.options.sort,
                    limit,
                    cursor: input.options.cursor,
                  }),
                ),
              );
              const tasks = [];
              for (const task of result.tasks) {
                const threadResult =
                  tasksRpcContract.listTaskThreads.output.parse(
                    await domain.listTaskThreads(
                      tasksRpcContract.listTaskThreads.input.parse({
                        taskId: task.id,
                      }),
                    ),
                  );
                tasks.push({
                  ...task,
                  labels: task.labelIds.map(
                    (id) => labelById.get(id)?.name ?? id,
                  ),
                  agentsWorking: threadResult.taskThreads.filter((thread) =>
                    ACTIVE_THREAD_STATUSES.has(thread.liveStatus),
                  ).length,
                });
              }
              if (input.options.json) {
                return JSON.stringify({
                  tasks,
                  nextCursor: result.nextCursor,
                  limit,
                });
              }
              const output = table(
                [
                  "KEY",
                  "STATUS",
                  "PRIORITY",
                  "DUE",
                  "TITLE",
                  "LABELS",
                  "AGENTS",
                ],
                tasks.map((task) => [
                  task.key,
                  task.status,
                  task.priority,
                  task.dueDate ?? "-",
                  task.title,
                  task.labels.join(", ") || "-",
                  task.agentsWorking,
                ]),
                "No tasks.",
              );
              return result.nextCursor === null
                ? output
                : `${output}\n\nMore results are available. Re-run with the same filters and add: --limit ${limit} --cursor ${result.nextCursor}`;
            });
          },
        }),

        show: cliCommand({
          summary: "Show full task details",
          aliases: ["get"],
          suggestFor: ["view", "read", "info", "detail", "details", "describe"],
          positionals: [KEY_POSITIONAL],
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const project = await resolveProject(domain, task.projectId);
              const allLabels = await projectLabels(domain, project.id);
              const labelById = new Map(
                allLabels.map((label) => [label.id, label]),
              );
              const labels = task.labelIds
                .map((id) => labelById.get(id)!)
                .filter(Boolean);
              const comments = tasksRpcContract.listComments.output.parse(
                await domain.listComments(
                  tasksRpcContract.listComments.input.parse({
                    taskId: task.id,
                  }),
                ),
              ).comments;
              const attachments = await listTaskAttachments(
                domain,
                task.id,
                comments,
              );
              const taskThreads = tasksRpcContract.listTaskThreads.output.parse(
                await domain.listTaskThreads(
                  tasksRpcContract.listTaskThreads.input.parse({
                    taskId: task.id,
                  }),
                ),
              ).taskThreads;
              const { pullRequests, unavailableThreadIds } =
                tasksRpcContract.listTaskPullRequests.output.parse(
                  await domain.listTaskPullRequests(
                    tasksRpcContract.listTaskPullRequests.input.parse({
                      taskId: task.id,
                    }),
                  ),
                );
              if (input.options.json) {
                return JSON.stringify({
                  task,
                  project,
                  labels,
                  attachments,
                  taskThreads,
                  pullRequests,
                  pullRequestUnavailableThreadIds: unavailableThreadIds,
                  comments,
                });
              }
              return [
                detail([
                  ["Task", `${task.key} — ${task.title}`],
                  ["ID", task.id],
                  ["Project", `${project.prefix} — ${project.name}`],
                  ["Status", task.status],
                  ["Priority", task.priority],
                  ["Due", task.dueDate ?? "-"],
                  [
                    "Labels",
                    labels.map((label) => label.name).join(", ") || "-",
                  ],
                  ["Created", task.createdAt],
                  ["Updated", task.updatedAt],
                ]),
                `Description\n${task.description || "(none)"}`,
                `Attachments\n${table(
                  ["ID", "NAME", "SIZE"],
                  attachments.map((attachment) => [
                    attachment.id,
                    attachment.fileName,
                    bytes(attachment.sizeBytes),
                  ]),
                  "(none)",
                )}`,
                `Attached threads\n${table(
                  ["THREAD", "STATUS", "PRESET", "TITLE"],
                  taskThreads.map((thread) => [
                    thread.threadId,
                    thread.liveStatus,
                    thread.presetName,
                    thread.title,
                  ]),
                  "(none)",
                )}`,
                `Pull requests\n${table(
                  ["PR", "STATE", "TITLE", "URL"],
                  pullRequests.map((pullRequest) => [
                    `#${pullRequest.number}`,
                    pullRequest.state,
                    pullRequest.title,
                    pullRequest.url,
                  ]),
                  "(none)",
                )}${
                  unavailableThreadIds.length > 0
                    ? `\nPR lookup unavailable for: ${unavailableThreadIds.join(", ")}`
                    : ""
                }`,
                `Comments\n${table(
                  ["TIME", "KIND", "AUTHOR", "PROVIDER", "BODY"],
                  comments.map((comment) => [
                    comment.createdAt,
                    comment.kind,
                    comment.threadTitle ?? comment.authorName,
                    comment.provider?.name ?? "-",
                    comment.body,
                  ]),
                  "(none)",
                )}`,
              ].join("\n\n");
            });
          },
        }),

        update: cliCommand({
          summary: "Update task fields and labels",
          positionals: [KEY_POSITIONAL],
          options: {
            status: {
              type: "enum",
              values: TASK_STATUSES,
              aliases: ["state"],
              description:
                "done when the task's criteria are met, todo to reopen it",
            },
            priority: {
              type: "enum",
              values: PRIORITIES,
              description: "New priority",
            },
            title: {
              type: "string",
              aliases: ["name", "subject"],
              description: "New title",
            },
            description: {
              type: "string",
              placeholder: "markdown",
              aliases: ["body", "details", "text", "content"],
              description:
                "Replacement markdown description; use --description-file for long text",
            },
            "description-file": {
              type: "string",
              placeholder: "path",
              description:
                "Read the replacement description from this UTF-8 file on the invoking machine",
            },
            due: {
              type: "string",
              placeholder: "YYYY-MM-DD",
              aliases: ["due-date"],
              description: "New due date as a calendar date, YYYY-MM-DD",
            },
            "no-due": { type: "boolean", description: "Clear the due date" },
            "add-label": {
              type: "string",
              repeatable: true,
              split: ",",
              placeholder: "name",
              description:
                "Existing label name to add; repeat or comma-separate",
            },
            "remove-label": {
              type: "string",
              repeatable: true,
              split: ",",
              placeholder: "name",
              description: "Label name to remove; repeat or comma-separate",
            },
            machine: MACHINE_OPTION,
            json: JSON_OPTION,
          },
          constraints: [
            {
              kind: "at-most-one",
              options: ["description", "description-file"],
            },
            { kind: "at-most-one", options: ["due", "no-due"] },
            {
              kind: "requires",
              option: "machine",
              needs: ["description-file"],
            },
          ],
          run(input, ctx) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const dueDate = input.options.due;
              const noDue = input.options["no-due"];
              const descriptionFile = input.options["description-file"];
              const clientHostId =
                descriptionFile !== undefined
                  ? await resolveClientHostId(
                      bb,
                      domain,
                      input.options.machine,
                      ctx,
                    )
                  : undefined;
              const description = await readTextOption(
                bb,
                ctx,
                clientHostId,
                input.options.description,
                descriptionFile,
              );
              const labels = await projectLabels(domain, task.projectId);
              const nextLabels = new Set(task.labelIds);
              for (const name of input.options["add-label"]) {
                nextLabels.add(resolveLabel(labels, name).id);
              }
              for (const name of input.options["remove-label"]) {
                nextLabels.delete(resolveLabel(labels, name).id);
              }
              const labelsChanged =
                input.options["add-label"].length > 0 ||
                input.options["remove-label"].length > 0;
              if (
                input.options.status === undefined &&
                input.options.priority === undefined &&
                input.options.title === undefined &&
                description === undefined &&
                dueDate === undefined &&
                !noDue &&
                !labelsChanged
              ) {
                throw new CliError("no task changes were provided", {
                  code: "no_changes",
                });
              }
              const result = tasksRpcContract.updateTask.output.parse(
                await domain.updateTask(
                  tasksRpcContract.updateTask.input.parse({
                    taskId: task.id,
                    status: input.options.status,
                    priority: input.options.priority,
                    title: input.options.title,
                    description,
                    dueDate: noDue ? null : dueDate,
                    labelIds: labelsChanged ? [...nextLabels] : undefined,
                    authorName: taskAuthor(ctx),
                  }),
                ),
              );
              const updated = unwrapTask(result);
              return input.options.json
                ? JSON.stringify({ task: updated })
                : `Updated ${updated.key}  ${updated.title}`;
            });
          },
        }),

        move: cliCommand({
          summary: "Move a task into another tracker project",
          description:
            "The task gets the next key in the destination project (for example ABC-12 becomes XYZ-4) and keeps its comments, attachments, and attached threads. Labels that belong only to the old project are removed.",
          positionals: [KEY_POSITIONAL],
          options: {
            project: {
              ...REQUIRED_PROJECT_OPTION,
              required: true,
            },
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const project = await resolveProject(
                domain,
                input.options.project,
              );
              const moved = unwrapTask(
                tasksRpcContract.moveTaskToProject.output.parse(
                  await domain.moveTaskToProject(
                    tasksRpcContract.moveTaskToProject.input.parse({
                      taskId: task.id,
                      projectId: project.id,
                      authorName: taskAuthor(ctx),
                    }),
                  ),
                ),
              );
              return input.options.json
                ? JSON.stringify({ task: moved, previousKey: task.key })
                : moved.key === task.key
                  ? `${task.key} is already in ${project.prefix}`
                  : `Moved ${task.key} to ${moved.key}  ${moved.title}`;
            });
          },
        }),

        reorder: cliCommand({
          summary: "Change a task's place in its project's task list",
          description:
            "Pass --after or --before another task in the same project. With neither, the task moves to the end of the list.",
          positionals: [KEY_POSITIONAL],
          options: {
            after: {
              type: "string",
              placeholder: "key-or-id",
              description: "Place directly after this task",
            },
            before: {
              type: "string",
              placeholder: "key-or-id",
              description: "Place directly before this task",
            },
            json: JSON_OPTION,
          },
          run(input) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const after = input.options.after
                ? await resolveTask(domain, input.options.after)
                : null;
              const before = input.options.before
                ? await resolveTask(domain, input.options.before)
                : null;
              const { task: reordered } =
                tasksRpcContract.reorderTask.output.parse(
                  await domain.reorderTask(
                    tasksRpcContract.reorderTask.input.parse({
                      taskId: task.id,
                      beforeTaskId: after?.id ?? null,
                      afterTaskId: before?.id ?? null,
                    }),
                  ),
                );
              return input.options.json
                ? JSON.stringify({ task: reordered })
                : `Reordered ${reordered.key}  ${reordered.title}`;
            });
          },
        }),

        comment: cliCommand({
          summary: "Add a markdown comment to a task",
          positionals: [KEY_POSITIONAL],
          options: {
            body: {
              type: "string",
              placeholder: "markdown",
              aliases: ["message", "text", "content"],
              description:
                "Comment markdown; use --body-file for long text (exactly one of the two)",
            },
            "body-file": {
              type: "string",
              placeholder: "path",
              description:
                "Read the comment from this UTF-8 file on the invoking machine",
            },
            author: {
              type: "string",
              placeholder: "name",
              description:
                "Display name for the comment; defaults to the invoking thread or cli",
            },
            notify: {
              type: "boolean",
              description:
                "Deliver the comment to the thread that wrote the task's latest agent reply",
            },
            machine: MACHINE_OPTION,
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "exactly-one", options: ["body", "body-file"] },
            { kind: "requires", option: "machine", needs: ["body-file"] },
          ],
          run(input, ctx) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const bodyFile = input.options["body-file"];
              const clientHostId =
                bodyFile !== undefined
                  ? await resolveClientHostId(
                      bb,
                      domain,
                      input.options.machine,
                      ctx,
                    )
                  : undefined;
              const body = await readTextOption(
                bb,
                ctx,
                clientHostId,
                input.options.body,
                bodyFile,
              );
              if (body === undefined) {
                throw new CliError("missing required --body or --body-file", {
                  code: "missing_required",
                });
              }
              if (!body.trim()) {
                throw new CliError("comment body must not be blank");
              }
              const comment = await createComment(bb, store, {
                taskId: task.id,
                kind: ctx.threadId ? "agent" : "user",
                authorName: input.options.author ?? taskAuthor(ctx),
                presetName: null,
                threadId: ctx.threadId ?? null,
                body,
                notify: input.options.notify,
              });
              return input.options.json
                ? JSON.stringify({ comment })
                : `Commented on ${task.key}  ${comment.id}`;
            });
          },
        }),

        label: groupCommand("label", "Create, list, or delete project labels", [
          ["create", "Create a label in a project"],
          ["list", "List a project's labels"],
          ["delete", "Delete a label"],
        ]),
        "label create": cliCommand({
          summary: "Create a project label",
          options: {
            project: REQUIRED_PROJECT_OPTION,
            name: { type: "string", required: true, description: "Label name" },
            color: {
              type: "string",
              default: DEFAULT_LABEL_COLOR,
              description: "Label color name",
            },
            json: JSON_OPTION,
          },
          unexpectedPositionalHint: "the label name belongs in --name <name>.",
          run(input, ctx) {
            return guard(async () => {
              const project = await requiredProject(
                domain,
                ctx,
                input.options.project,
              );
              const result = tasksRpcContract.createLabel.output.parse(
                await domain.createLabel(
                  tasksRpcContract.createLabel.input.parse({
                    projectId: project.id,
                    name: input.options.name,
                    color: input.options.color,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify(result)
                : `Created label ${result.label.name}  ${result.label.id}`;
            });
          },
        }),
        "label list": cliCommand({
          summary: "List a project's labels",
          options: { project: REQUIRED_PROJECT_OPTION, json: JSON_OPTION },
          run(input, ctx) {
            return guard(async () => {
              const project = await requiredProject(
                domain,
                ctx,
                input.options.project,
              );
              const labels = await projectLabels(domain, project.id);
              return input.options.json
                ? JSON.stringify({ labels })
                : table(
                    ["NAME", "COLOR", "ID"],
                    labels.map((label) => [label.name, label.color, label.id]),
                    "No labels.",
                  );
            });
          },
        }),
        "label delete": cliCommand({
          summary: "Delete a project label",
          positionals: [
            {
              name: "name-or-id",
              description: "Label name or its ULID",
              required: true,
            },
          ],
          options: { project: REQUIRED_PROJECT_OPTION, json: JSON_OPTION },
          run(input, ctx) {
            return guard(async () => {
              const project = await requiredProject(
                domain,
                ctx,
                input.options.project,
              );
              const label = resolveLabel(
                await projectLabels(domain, project.id),
                input.positionals["name-or-id"],
              );
              const result = tasksRpcContract.deleteLabel.output.parse(
                await domain.deleteLabel(
                  tasksRpcContract.deleteLabel.input.parse({
                    labelId: label.id,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify({ ...result, label })
                : `Deleted label ${label.name}`;
            });
          },
        }),

        attachment: groupCommand(
          "attachment",
          "Add, download, list, or remove project and task attachments",
          [
            ["add", "Attach a file to a project, task, or comment"],
            ["get", "Download an attachment to a path"],
            ["list", "List a project's or task's attachments"],
            ["remove", "Remove an attachment"],
          ],
        ),
        "attachment add": cliCommand({
          summary: "Attach a file to a project, task, or comment",
          description:
            "Pass a task key or comment ULID, or --project for a project attachment. File paths are read from the invoking machine: the thread's machine inside an agent thread, otherwise the server's.",
          positionals: [
            {
              name: "key-or-comment-id",
              description:
                "Task key such as ABC-12, a task ULID, or a comment ULID; omit with --project",
            },
          ],
          options: {
            project: PROJECT_ATTACHMENT_OPTION,
            file: {
              type: "string",
              required: true,
              placeholder: "path",
              aliases: ["path", "attach"],
              description: "Source file to upload, at most 25 MB",
            },
            name: {
              type: "string",
              description: "Stored file name; defaults to the source basename",
            },
            machine: MACHINE_OPTION,
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              const sourcePath = resolve(
                ctx.cwd ?? process.cwd(),
                input.options.file,
              );
              const owner = await resolveAttachmentOwner(
                domain,
                store.tasks,
                input.positionals["key-or-comment-id"],
                input.options.project,
              );
              const clientHostId = await resolveClientHostId(
                bb,
                domain,
                input.options.machine,
                ctx,
              );
              const content = await readAttachmentSource(
                bb,
                clientHostId,
                sourcePath,
              );
              const attachment = await saveAttachmentFromBytes(
                store.tasks,
                content,
                {
                  ...owner,
                  fileName:
                    input.options.name ?? attachmentFileName(sourcePath),
                },
              );
              publishAttachmentChanged(bb, store.tasks, attachment);
              return input.options.json
                ? JSON.stringify({
                    attachment,
                    url: attachmentDownloadUrl(attachment.id),
                  })
                : `Added attachment ${attachment.fileName}  ${attachment.id}`;
            });
          },
        }),
        "attachment get": cliCommand({
          summary: "Download an attachment to a path",
          description:
            "The file is written on the invoking machine: the thread's machine inside an agent thread, otherwise the server's.",
          positionals: [
            {
              name: "attachment-id",
              description: "Attachment ULID from bb my-tasks attachment list",
              required: true,
            },
          ],
          options: {
            out: {
              type: "string",
              required: true,
              placeholder: "path",
              short: "o",
              aliases: ["output", "to"],
              description:
                "Destination path; missing parent directories are created",
            },
            machine: MACHINE_OPTION,
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              const outPath = resolve(
                ctx.cwd ?? process.cwd(),
                input.options.out,
              );
              const clientHostId = await resolveClientHostId(
                bb,
                domain,
                input.options.machine,
                ctx,
              );
              const { attachment, content } = await readAttachmentContent(
                store.tasks,
                input.positionals["attachment-id"],
              );
              await writeClientFile(bb, clientHostId, outPath, content);
              return input.options.json
                ? JSON.stringify({ attachment, out: outPath })
                : `Saved ${attachment.fileName}  ${outPath}`;
            });
          },
        }),
        "attachment list": cliCommand({
          summary: "List a project's or task's attachments",
          description:
            "A task's list includes its comments' attachments. Pass --project instead of a task key for the project's own attachments.",
          positionals: [
            {
              name: "key-or-id",
              description:
                "Task key such as ABC-12 (case-insensitive) or its ULID; omit with --project",
            },
          ],
          options: { project: PROJECT_ATTACHMENT_OPTION, json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const taskAddress = input.positionals["key-or-id"];
              if (input.options.project !== undefined) {
                if (taskAddress !== undefined) {
                  throw new CliError(
                    "pass either a task key or --project, not both",
                    { code: "attachment_owner_conflict" },
                  );
                }
                const project = await resolveProject(
                  domain,
                  input.options.project,
                );
                const attachments = tasksRpcContract.listAttachments.output.parse(
                  await domain.listAttachments(
                    tasksRpcContract.listAttachments.input.parse({
                      projectId: project.id,
                    }),
                  ),
                ).attachments;
                return input.options.json
                  ? JSON.stringify({ project, attachments })
                  : attachmentTable(attachments);
              }
              if (taskAddress === undefined) {
                throw new CliError("pass a task key or --project", {
                  code: "attachment_owner_missing",
                });
              }
              const task = await resolveTask(domain, taskAddress);
              const comments = tasksRpcContract.listComments.output.parse(
                await domain.listComments(
                  tasksRpcContract.listComments.input.parse({
                    taskId: task.id,
                  }),
                ),
              ).comments;
              const attachments = await listTaskAttachments(
                domain,
                task.id,
                comments,
              );
              return input.options.json
                ? JSON.stringify({ task, attachments })
                : attachmentTable(attachments);
            });
          },
        }),
        "attachment remove": cliCommand({
          summary: "Remove an attachment",
          positionals: [
            {
              name: "attachment-id",
              description: "Attachment ULID from bb my-tasks attachment list",
              required: true,
            },
          ],
          options: {
            "remove-references": {
              type: "boolean",
              description:
                "Also strip the attachment's links from the project or task description",
            },
            json: JSON_OPTION,
          },
          run(input) {
            return guard(async () => {
              const attachmentId = input.positionals["attachment-id"];
              const result = tasksRpcContract.deleteAttachment.output.parse(
                await domain.deleteAttachment(
                  tasksRpcContract.deleteAttachment.input.parse({
                    attachmentId: attachmentId.trim(),
                    removeDescriptionReferences:
                      input.options["remove-references"],
                  }),
                ),
              );
              if (!result.ok) throw new CliError(result.error.message);
              if (!result.deleted) {
                throw new CliError(`attachment not found: ${attachmentId}`, {
                  code: "attachment_not_found",
                });
              }
              return input.options.json
                ? JSON.stringify({
                    deleted: true,
                    attachment: result.attachment,
                  })
                : `Removed attachment ${result.attachment.fileName}  ${result.attachment.id}`;
            });
          },
        }),

        preset: groupCommand(
          "preset",
          "List, show, create, update, or delete dispatch presets",
          [
            ["list", "List dispatch presets"],
            ["show", "Show one preset"],
            ["create", "Create a preset"],
            ["update", "Update a preset"],
            ["delete", "Delete a preset"],
          ],
        ),
        "preset list": cliCommand({
          summary: "List dispatch presets",
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const presets = await listPresets(domain);
              return input.options.json
                ? JSON.stringify({ presets })
                : table(
                    [
                      "NAME",
                      "PROVIDER",
                      "MODEL",
                      "REASONING",
                      "SERVICE TIER",
                      "PERMISSION",
                      "ENVIRONMENT",
                      "BASE BRANCH",
                      "MACHINE",
                      "BUILTIN",
                      "ID",
                    ],
                    presets.map((preset) => [
                      preset.name,
                      preset.providerId,
                      preset.modelId,
                      preset.reasoningLevel,
                      preset.serviceTier ?? "-",
                      preset.permissionMode,
                      presetEnvironmentLabel(preset),
                      preset.baseBranch ?? "-",
                      preset.machineId ?? "-",
                      preset.builtin ? "yes" : "no",
                      preset.id,
                    ]),
                    "No presets.",
                  );
            });
          },
        }),
        "preset show": cliCommand({
          summary: "Show one dispatch preset",
          positionals: [
            {
              name: "name-or-id",
              description: "Preset name (case-insensitive) or its ULID",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const preset = resolvePreset(
                await listPresets(domain),
                input.positionals["name-or-id"],
              );
              return input.options.json
                ? JSON.stringify({ preset })
                : detail([
                    ["Name", preset.name],
                    ["Provider", preset.providerId],
                    ["Model", preset.modelId],
                    ["Reasoning", preset.reasoningLevel],
                    ["Service tier", preset.serviceTier ?? "-"],
                    ["Permission", preset.permissionMode],
                    ["Environment", presetEnvironmentLabel(preset)],
                    ["Base branch", preset.baseBranch ?? "-"],
                    ["Machine", preset.machineId ?? "-"],
                    ["Instructions", preset.instructions || "-"],
                    ["Built in", preset.builtin ? "yes" : "no"],
                    ["ID", preset.id],
                  ]);
            });
          },
        }),
        "preset create": cliCommand({
          summary: "Create a dispatch preset",
          options: {
            name: {
              type: "string",
              required: true,
              description: "Preset name shown in dispatch menus",
            },
            provider: {
              type: "string",
              required: true,
              placeholder: "id",
              description: "Provider id such as codex or claude-code",
            },
            model: {
              type: "string",
              required: true,
              placeholder: "id",
              description: "Model id as the provider spells it",
            },
            reasoning: {
              type: "enum",
              values: presetReasoningLevelSchema.options,
              required: true,
              description: "Reasoning level the provider supports",
            },
            permission: {
              type: "enum",
              values: PRESET_PERMISSION_MODES,
              required: true,
              description: "Permission mode for the dispatched thread",
            },
            "service-tier": {
              type: "enum",
              values: PRESET_SERVICE_TIERS,
              description: "Service tier; none clears it",
            },
            environment: {
              type: "enum",
              values: PRESET_ENVIRONMENTS,
              default: "project-default",
              description:
                "Where the thread runs; --base-branch and --machine require worktree",
            },
            "base-branch": {
              type: "string",
              placeholder: "branch",
              description: "Branch new worktrees start from",
            },
            machine: {
              type: "string",
              placeholder: "id-or-name",
              description: "Enrolled machine that hosts the worktree",
            },
            instructions: {
              type: "string",
              placeholder: "text",
              description: "Extra instructions prepended to every dispatch",
            },
            json: JSON_OPTION,
          },
          run(input) {
            return guard(async () => {
              const environmentKind = presetEnvironmentKind(
                input.options.environment,
                "project-default",
              );
              const baseBranch = input.options["base-branch"];
              const machine = input.options.machine;
              validatePresetTargetOptions({
                environmentKind,
                baseBranch,
                machine,
              });
              const result = tasksRpcContract.createPreset.output.parse(
                await domain.createPreset(
                  tasksRpcContract.createPreset.input.parse({
                    name: input.options.name,
                    providerId: input.options.provider,
                    modelId: input.options.model,
                    reasoningLevel: input.options.reasoning,
                    serviceTier:
                      presetServiceTier(input.options["service-tier"]) ?? null,
                    permissionMode: input.options.permission,
                    environmentKind,
                    baseBranch: baseBranch ?? null,
                    machineId:
                      machine === undefined
                        ? null
                        : await resolveMachineId(domain, machine),
                    instructions: input.options.instructions ?? "",
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify(result)
                : `Created preset ${result.preset.name}  ${result.preset.id}`;
            });
          },
        }),
        "preset update": cliCommand({
          summary: "Update a dispatch preset",
          positionals: [
            {
              name: "name-or-id",
              description: "Preset name (case-insensitive) or its ULID",
              required: true,
            },
          ],
          options: {
            name: { type: "string", description: "New preset name" },
            provider: {
              type: "string",
              placeholder: "id",
              description: "Provider id such as codex or claude-code",
            },
            model: {
              type: "string",
              placeholder: "id",
              description: "Model id as the provider spells it",
            },
            reasoning: {
              type: "enum",
              values: presetReasoningLevelSchema.options,
              description: "Reasoning level the provider supports",
            },
            permission: {
              type: "enum",
              values: PRESET_PERMISSION_MODES,
              description: "Permission mode for the dispatched thread",
            },
            "service-tier": {
              type: "enum",
              values: PRESET_SERVICE_TIERS,
              description: "Service tier; none clears it",
            },
            environment: {
              type: "enum",
              values: PRESET_ENVIRONMENTS,
              description:
                "Where the thread runs; switching to project-default clears --base-branch and --machine",
            },
            "base-branch": {
              type: "string",
              placeholder: "branch",
              description: "Branch new worktrees start from",
            },
            machine: {
              type: "string",
              placeholder: "id-or-name",
              description: "Enrolled machine that hosts the worktree",
            },
            instructions: {
              type: "string",
              placeholder: "text",
              description: "Extra instructions prepended to every dispatch",
            },
            json: JSON_OPTION,
          },
          run(input) {
            return guard(async () => {
              const preset = resolvePreset(
                await listPresets(domain),
                input.positionals["name-or-id"],
              );
              const environmentOption = input.options.environment;
              const environmentKind = presetEnvironmentKind(
                environmentOption,
                preset.environmentKind,
              );
              const baseBranch = input.options["base-branch"];
              const machine = input.options.machine;
              validatePresetTargetOptions({
                environmentKind,
                baseBranch,
                machine,
              });
              const result = tasksRpcContract.updatePreset.output.parse(
                await domain.updatePreset(
                  tasksRpcContract.updatePreset.input.parse({
                    presetId: preset.id,
                    name: input.options.name,
                    providerId: input.options.provider,
                    modelId: input.options.model,
                    reasoningLevel: input.options.reasoning,
                    serviceTier: presetServiceTier(
                      input.options["service-tier"],
                    ),
                    permissionMode: input.options.permission,
                    environmentKind:
                      environmentOption === undefined
                        ? undefined
                        : environmentKind,
                    baseBranch:
                      environmentOption !== undefined &&
                      environmentKind === "project-default"
                        ? null
                        : baseBranch,
                    machineId:
                      environmentOption !== undefined &&
                      environmentKind === "project-default"
                        ? null
                        : machine === undefined
                          ? undefined
                          : await resolveMachineId(domain, machine),
                    instructions: input.options.instructions,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify(result)
                : `Updated preset ${result.preset.name}  ${result.preset.id}`;
            });
          },
        }),
        "preset delete": cliCommand({
          summary: "Delete a dispatch preset",
          positionals: [
            {
              name: "name-or-id",
              description: "Preset name (case-insensitive) or its ULID",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const preset = resolvePreset(
                await listPresets(domain),
                input.positionals["name-or-id"],
              );
              const result = tasksRpcContract.deletePreset.output.parse(
                await domain.deletePreset(
                  tasksRpcContract.deletePreset.input.parse({
                    presetId: preset.id,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify({ ...result, preset })
                : `Deleted preset ${preset.name}`;
            });
          },
        }),

        dispatch: cliCommand({
          summary: "Dispatch a task to a new agent thread",
          aliases: ["delegate"],
          suggestFor: ["start", "run", "spawn"],
          positionals: [KEY_POSITIONAL],
          options: {
            preset: {
              type: "string",
              required: true,
              placeholder: "name-or-id",
              description:
                "Dispatch preset name or id; run bb my-tasks preset list to see them",
            },
            instructions: {
              type: "string",
              placeholder: "text",
              aliases: ["extra-instructions"],
              description: "Extra instructions for this dispatch only",
            },
            json: JSON_OPTION,
          },
          run(input) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const preset = resolvePreset(
                await listPresets(domain),
                input.options.preset,
              );
              const result = delegationRpcContract.delegate.output.parse(
                await delegationHandlers(bb, store).delegate(
                  delegationRpcContract.delegate.input.parse({
                    taskId: task.id,
                    presetId: preset.id,
                    extraInstructions: input.options.instructions,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify({ task, preset, ...result })
                : result.threadId;
            });
          },
        }),

        attach: cliCommand({
          summary: "Attach an existing agent thread to a task",
          positionals: [KEY_POSITIONAL],
          options: {
            thread: {
              type: "string",
              placeholder: "thread-id",
              aliases: ["thread-id"],
              description:
                "Thread to attach; defaults to BB_THREAD_ID or the invoking thread",
            },
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const threadId = resolveInvokingThreadId(
                input.options.thread,
                ctx,
              );
              const result =
                delegationRpcContract.taskThreadsAttach.output.parse(
                  await delegationHandlers(bb, store).taskThreadsAttach(
                    delegationRpcContract.taskThreadsAttach.input.parse({
                      taskId: task.id,
                      threadId,
                    }),
                  ),
                );
              return input.options.json
                ? JSON.stringify({ task, ...result })
                : `Attached ${result.threadId} to ${task.key}`;
            });
          },
        }),

        detach: cliCommand({
          summary: "Detach an agent thread from a task",
          positionals: [KEY_POSITIONAL],
          options: {
            thread: {
              type: "string",
              placeholder: "thread-id",
              aliases: ["thread-id"],
              description:
                "Thread to detach; defaults to BB_THREAD_ID or the invoking thread",
            },
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const threadId = resolveInvokingThreadId(
                input.options.thread,
                ctx,
              );
              const result =
                delegationRpcContract.taskThreadsDetach.output.parse(
                  await delegationHandlers(bb, store).taskThreadsDetach(
                    delegationRpcContract.taskThreadsDetach.input.parse({
                      taskId: task.id,
                      threadId,
                    }),
                  ),
                );
              return input.options.json
                ? JSON.stringify({ task, ...result })
                : `Detached ${result.threadId} from ${task.key}`;
            });
          },
        }),

        threads: cliCommand({
          summary: "List agent threads attached to a task",
          positionals: [KEY_POSITIONAL],
          options: { json: JSON_OPTION },
          run(input) {
            return guard(async () => {
              const task = await resolveTask(
                domain,
                input.positionals["key-or-id"],
              );
              const result = tasksRpcContract.listTaskThreads.output.parse(
                await domain.listTaskThreads(
                  tasksRpcContract.listTaskThreads.input.parse({
                    taskId: task.id,
                  }),
                ),
              );
              return input.options.json
                ? JSON.stringify({ task, taskThreads: result.taskThreads })
                : table(
                    ["THREAD", "STATUS", "PRESET", "TITLE"],
                    result.taskThreads.map((thread) => [
                      thread.threadId,
                      thread.liveStatus,
                      thread.presetName,
                      thread.title,
                    ]),
                    "No attached threads.",
                  );
            });
          },
        }),

        links: cliCommand({
          summary: "List the tasks and projects a thread is attached to",
          options: {
            thread: {
              type: "string",
              placeholder: "thread-id",
              aliases: ["thread-id"],
              description:
                "Thread to look up; defaults to BB_THREAD_ID or the invoking thread",
            },
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              const threadId = resolveInvokingThreadId(
                input.options.thread,
                ctx,
              );
              const result = tasksRpcContract.listThreadLinks.output.parse(
                await domain.listThreadLinks(
                  tasksRpcContract.listThreadLinks.input.parse({ threadId }),
                ),
              );
              return input.options.json
                ? JSON.stringify({ threadId, ...result })
                : table(
                    ["KIND", "KEY", "TITLE"],
                    [
                      ...result.projects.map((project) => [
                        "project",
                        project.prefix,
                        project.name,
                      ]),
                      ...result.tasks.map((task) => [
                        "task",
                        task.key,
                        task.title,
                      ]),
                    ],
                    "Not attached to any task or project.",
                  );
            });
          },
        }),

        "seed-demo": cliCommand({
          summary:
            "Create sample folders, projects, labels, tasks, and comments",
          options: {
            yes: {
              type: "boolean",
              description: "Confirm writing sample data into this workspace",
            },
            json: JSON_OPTION,
          },
          run(input, ctx) {
            return guard(async () => {
              if (!input.options.yes) {
                throw new CliError(
                  "seed-demo creates sample data; re-run with --yes",
                  { code: "confirmation_required" },
                );
              }
              const result = await seedDemo(domain, ctx.projectId);
              return input.options.json
                ? JSON.stringify(result)
                : detail([
                    ["Folders", result.foldersCreated],
                    ["Projects", result.projectsCreated],
                    ["Labels", result.labelsCreated],
                    ["Tasks", result.tasksCreated],
                    ["Comments", result.commentsCreated],
                    ["BB project", result.linkedBbProjectId ?? "-"],
                  ]);
            });
          },
        }),
      },
    }),
  );
}
