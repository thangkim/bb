import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Icon } from "@/components/ui/icon";
import type { DelegationRpcContract } from "../delegate/contract.js";
import type { Project, Task } from "../shared/contract.js";
import { errorMessage } from "../shared/errors.js";
import { useProjects, useTasksQuery, useTasksRpc } from "../shell/data.js";
import { TasksRefreshProvider } from "../shell/refresh.js";
import {
  closeThreadLinks,
  getThreadLinksTarget,
  subscribeThreadLinks,
  type ThreadLinksTarget,
} from "./store.js";

const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_LIMIT = 20;
const SUGGESTED_TASKS_PER_PROJECT = 10;
const CLOSED_PROJECT_STATUSES: ReadonlySet<Project["status"]> = new Set([
  "done",
  "canceled",
]);

export function ThreadLinksOverlay() {
  const target = useSyncExternalStore(
    subscribeThreadLinks,
    getThreadLinksTarget,
    () => null,
  );
  if (target === null) return null;
  return (
    <TasksRefreshProvider>
      <ThreadLinksDialog key={target.request} target={target} />
    </TasksRefreshProvider>
  );
}

function matchesProject(project: Project, query: string): boolean {
  return (
    project.name.toLowerCase().includes(query) ||
    project.prefix.toLowerCase().includes(query)
  );
}

function projectRank(project: Project, bbProjectId: string): number {
  if (CLOSED_PROJECT_STATUSES.has(project.status)) return 2;
  return project.linkedBbProjectId === bbProjectId ? 0 : 1;
}

function useTaskCandidates(
  query: string,
  suggestedProjectIds: readonly string[],
  onError: (message: string) => void,
): Task[] | null {
  const rpc = useTasksRpc();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const suggestedKey = suggestedProjectIds.join(",");

  useEffect(() => {
    let cancelled = false;
    const projectIds = suggestedKey === "" ? [] : suggestedKey.split(",");
    const timer = window.setTimeout(() => {
      const request =
        query === ""
          ? Promise.all(
              projectIds.map((projectId) =>
                rpc.call("listTasks", {
                  projectId,
                  statuses: ["todo"],
                  limit: SUGGESTED_TASKS_PER_PROJECT,
                }),
              ),
            ).then((pages) => pages.flatMap((page) => page.tasks))
          : rpc
              .call("listTasks", { search: query, limit: SEARCH_LIMIT })
              .then((page) => page.tasks);
      request.then(
        (next) => {
          if (!cancelled) setTasks(next);
        },
        (error: unknown) => {
          if (cancelled) return;
          setTasks([]);
          onError(errorMessage(error));
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, suggestedKey, rpc, onError]);

  return tasks;
}

function ProjectDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

function ProjectItem({
  project,
  attached,
  disabled,
  onSelect,
}: {
  project: Project;
  attached: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={`project:${project.id}`}
      disabled={disabled}
      onSelect={onSelect}
    >
      <ProjectDot color={project.color} />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      <span className="text-xs text-muted-foreground">{project.prefix}</span>
      {attached ? <Icon name="Check" className="size-3.5" /> : null}
    </CommandItem>
  );
}

function TaskItem({
  task,
  project,
  attached,
  disabled,
  onSelect,
}: {
  task: Task;
  project: Project | undefined;
  attached: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={`task:${task.id}`}
      disabled={disabled}
      onSelect={onSelect}
    >
      <Icon
        name={task.status === "done" ? "CircleCheck" : "Circle"}
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {task.key}
      </span>
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
      {project ? (
        <span className="max-w-28 truncate text-xs text-muted-foreground">
          {project.name}
        </span>
      ) : null}
      {attached ? <Icon name="Check" className="size-3.5" /> : null}
    </CommandItem>
  );
}

function ThreadLinksDialog({ target }: { target: ThreadLinksTarget }) {
  const delegation = useRpc<DelegationRpcContract>();
  const projectsQuery = useProjects();
  const links = useTasksQuery(
    (rpc) => rpc.call("listThreadLinks", { threadId: target.threadId }),
    ["tasks:changed", "projects:changed", "threads:changed"],
    [target.threadId],
  );
  const [query, setQuery] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const suggestedProjectIds = useMemo(
    () =>
      projects
        .filter(
          (project) =>
            project.linkedBbProjectId === target.projectId &&
            !CLOSED_PROJECT_STATUSES.has(project.status),
        )
        .map((project) => project.id),
    [projects, target.projectId],
  );
  const taskCandidates = useTaskCandidates(
    normalizedQuery,
    suggestedProjectIds,
    setError,
  );

  const attachedTasks = links.data?.tasks ?? [];
  const attachedProjects = links.data?.projects ?? [];
  const attachedTaskIds = new Set(attachedTasks.map((task) => task.id));
  const attachedProjectIds = new Set(
    attachedProjects.map((project) => project.id),
  );

  const projectResults = projects
    .filter(
      (project) =>
        !attachedProjectIds.has(project.id) &&
        (normalizedQuery === "" || matchesProject(project, normalizedQuery)),
    )
    .sort(
      (left, right) =>
        projectRank(left, target.projectId) -
        projectRank(right, target.projectId),
    );
  const taskResults = (taskCandidates ?? []).filter(
    (task) => !attachedTaskIds.has(task.id),
  );

  const toggleProject = async (project: Project) => {
    const key = `project:${project.id}`;
    setPendingKey(key);
    setError(null);
    try {
      const input = { projectId: project.id, threadId: target.threadId };
      if (attachedProjectIds.has(project.id)) {
        await delegation.call("projectThreadsDetach", input);
      } else {
        await delegation.call("projectThreadsAttach", input);
      }
      links.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPendingKey(null);
    }
  };

  const toggleTask = async (task: Task) => {
    const key = `task:${task.id}`;
    setPendingKey(key);
    setError(null);
    try {
      const input = { taskId: task.id, threadId: target.threadId };
      if (attachedTaskIds.has(task.id)) {
        await delegation.call("taskThreadsDetach", input);
      } else {
        await delegation.call("taskThreadsAttach", input);
      }
      links.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPendingKey(null);
    }
  };

  const hasAttached = attachedProjects.length + attachedTasks.length > 0;
  const isSearching = taskCandidates === null || projectsQuery.data === undefined;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeThreadLinks();
      }}
    >
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
        <DialogTitle className="px-4 pt-4 text-sm font-medium">
          Attach to My Tasks
        </DialogTitle>
        <DialogDescription className="px-4 pb-3 pt-1 text-xs text-muted-foreground">
          Pick projects or tasks this thread is working on. Select an
          attached item to detach it.
        </DialogDescription>
        <Command shouldFilter={false} className="border-t border-border-hairline">
          <CommandInput
            placeholder="Search projects and tasks…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-80">
            <CommandEmpty>
              {isSearching ? "Searching…" : "No matching projects or tasks."}
            </CommandEmpty>
            {hasAttached ? (
              <CommandGroup heading="Attached">
                {attachedProjects.map((project) => (
                  <ProjectItem
                    key={project.id}
                    project={project}
                    attached
                    disabled={pendingKey !== null}
                    onSelect={() => void toggleProject(project)}
                  />
                ))}
                {attachedTasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    project={projectsById.get(task.projectId)}
                    attached
                    disabled={pendingKey !== null}
                    onSelect={() => void toggleTask(task)}
                  />
                ))}
              </CommandGroup>
            ) : null}
            {taskResults.length > 0 ? (
              <CommandGroup heading={normalizedQuery === "" ? "Open tasks" : "Tasks"}>
                {taskResults.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    project={projectsById.get(task.projectId)}
                    attached={false}
                    disabled={pendingKey !== null}
                    onSelect={() => void toggleTask(task)}
                  />
                ))}
              </CommandGroup>
            ) : null}
            {projectResults.length > 0 ? (
              <CommandGroup heading="Projects">
                {projectResults.map((project) => (
                  <ProjectItem
                    key={project.id}
                    project={project}
                    attached={false}
                    disabled={pendingKey !== null}
                    onSelect={() => void toggleProject(project)}
                  />
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
        {error !== null ? (
          <p role="alert" className="border-t border-border-hairline px-4 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
