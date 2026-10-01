import type { BbPluginApi, PluginMentionItem } from "@get-bb/plugin-sdk";

import type { TasksApiStore } from "../api";
import { escapeLike, type Project, type ProjectThread } from "../db";
import { displayName } from "../shared/display-name";
import { formatProjectTasks } from "./index";

const SEARCH_LIMIT = 10;

type PluginDatabase = ReturnType<BbPluginApi["storage"]["database"]>;

interface MentionProjectRow {
  id: string;
  prefix: string;
  name: string;
  status: Project["status"];
}

function searchProjects(
  database: PluginDatabase,
  query: string,
): PluginMentionItem[] {
  const normalizedQuery = query.trim();
  const search = `%${escapeLike(normalizedQuery)}%`;
  const rows = database
    .prepare<{ search: string }, MentionProjectRow>(
      `
        SELECT id, prefix, name, status
        FROM projects
        WHERE @search = '%%'
          OR prefix LIKE @search ESCAPE '\\'
          OR name LIKE @search ESCAPE '\\'
        ORDER BY name COLLATE NOCASE, id
        LIMIT ${SEARCH_LIMIT}
      `,
    )
    .all({ search });

  return rows.map((row) => ({
    id: row.id,
    title: `${row.prefix} · ${row.name}`,
    subtitle: displayName(row.status),
  }));
}

function formatProjectThreads(threads: readonly ProjectThread[]): string {
  if (threads.length === 0) return "None.";
  return threads
    .map((thread) => `- ${thread.threadId} · ${thread.title}`)
    .join("\n");
}

function buildProjectContext(store: TasksApiStore, projectId: string): string {
  const project = store.tasks.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  return `# ${project.prefix} · ${project.name}

## Project details

- Status: ${displayName(project.status)}
- Priority: ${displayName(project.priority)}
- Due: ${project.dueDate ?? "None"}
- Linked bb project: ${project.linkedBbProjectId ?? "Not linked"}

## Description

${project.description.trim() || "No description provided."}

## Tasks in this project

${formatProjectTasks(store.tasks.listTasks({ projectId: project.id }))}

## Attached threads

${formatProjectThreads(store.tasks.listProjectThreads(project.id))}

## Action contract

If you begin working on this project, first run: bb my-tasks project attach ${project.prefix} (attaches THIS thread to the project).
`;
}

export function registerProjectMentions(
  bb: BbPluginApi,
  store: TasksApiStore,
): void {
  const database = bb.storage.database();

  bb.ui.registerMentionProvider({
    id: "project",
    label: "My Tasks Projects",
    search({ query }) {
      return searchProjects(database, query);
    },
    resolve(itemId) {
      return { context: buildProjectContext(store, itemId) };
    },
  });
}
