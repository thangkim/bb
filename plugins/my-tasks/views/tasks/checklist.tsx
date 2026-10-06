import { useCallback, useMemo, useState } from "react";
import { useSettings } from "@get-bb/plugin-sdk/app";
import { HugeiconsIcon } from "@hugeicons/react";
import Tag01Icon from "@hugeicons/core-free-icons/Tag01Icon";
import type {
  Label,
  Preset,
  Project,
  Task,
  TaskThread,
} from "../../shared/contract.js";
import { errorMessage } from "../../shared/errors.js";
import { readShowCompletedTasks } from "../../shared/settings.js";
import { useTasksRpc } from "../../shell/data.js";
import { useTasksNavigation } from "../../shell/routes.js";
import { useOpenThreadInSplit } from "../../components/use-open-thread-in-split.js";
import { useActiveThread } from "../../components/active-thread.js";
import { isActiveThread, THREAD_STATUS_META } from "../detail/meta.js";
import {
  useProjectTasks,
  useTaskListMeta,
  type TaskRowMeta,
} from "../list/data.js";
import { TaskCheckbox } from "../list/icons.js";
import { partitionLabels } from "../list/lib.js";
import { editedTasks } from "../list/optimistic.js";
import {
  CHIP_TRIGGER_CLASS,
  DueDateChip,
  TaskContextMenu,
  type TaskEditFn,
} from "../list/property-menus.js";
import { useListTaskEdits } from "../list/use-task-edits.js";
import { AttachThreadPicker, NewThreadMenu } from "./thread-actions.js";
import { useMoveTaskToProject, writeDraggedTask } from "./move-task.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function LabelChips({
  task,
  labelsById,
  projectLabels,
  onEdit,
}: {
  task: Task;
  labelsById: ReadonlyMap<string, Label>;
  projectLabels: readonly Label[];
  onEdit: TaskEditFn;
}) {
  const labels = task.labelIds.flatMap((id) => labelsById.get(id) ?? []);
  if (labels.length === 0) return null;
  const { visible, hidden } = partitionLabels(labels, 2);
  const toggleLabel = (labelId: string) => {
    const labelIds = task.labelIds.includes(labelId)
      ? task.labelIds.filter((id) => id !== labelId)
      : [...task.labelIds, labelId];
    onEdit(task, { labelIds });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Edit labels"
          className={cn(CHIP_TRIGGER_CLASS, "min-w-0 max-w-40")}
        >
          <HugeiconsIcon
            icon={Tag01Icon}
            className="size-3 shrink-0 text-muted-foreground"
          />
          <span className="truncate">
            {visible.map((label) => label.name).join(", ")}
          </span>
          {hidden.length > 0 ? (
            <span className="tabular-nums">+{hidden.length}</span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {projectLabels.map((label) => (
          <DropdownMenuCheckboxItem
            key={label.id}
            checked={task.labelIds.includes(label.id)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => toggleLabel(label.id)}
          >
            <span
              aria-hidden
              className="mr-2 size-2 rounded-full"
              style={{ backgroundColor: label.color }}
            />
            {label.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThreadRow({ thread }: { thread: TaskThread }) {
  return (
    <ThreadLink
      threadId={thread.threadId}
      title={thread.title}
      statusLabel={THREAD_STATUS_META[thread.liveStatus].label}
      working={isActiveThread(thread)}
    />
  );
}

export function ThreadLink({
  threadId,
  title,
  statusLabel,
  working,
}: {
  threadId: string;
  title: string;
  statusLabel: string | null;
  working: boolean;
}) {
  const openThread = useOpenThreadInSplit();
  const active = useActiveThread().threadId === threadId;
  return (
    <button
      type="button"
      aria-label={statusLabel === null ? title : `${title} — ${statusLabel}`}
      data-active-thread={active || undefined}
      onClick={() => openThread(threadId)}
      className={cn(
        "relative z-10 flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:text-foreground",
        active
          ? "bg-state-active text-foreground"
          : "text-subtle-foreground hover:bg-state-hover",
      )}
    >
      <Icon name="MessageSquare" className="size-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {working ? (
        <Icon
          name="RotateCcw"
          className="size-3 shrink-0 animate-spin text-timeline-accent"
        />
      ) : null}
    </button>
  );
}

interface TaskChecklistRowProps {
  task: Task;
  meta: TaskRowMeta | undefined;
  labelsById: ReadonlyMap<string, Label>;
  projectLabels: readonly Label[];
  presets: Preset[] | undefined;
  otherProjects: readonly Project[];
  unlinkedProjectId: string | null;
  pending: boolean;
  onEdit: TaskEditFn;
  onDelete: () => void;
  onMoveToProject: (projectId: string) => void;
  onError: (message: string) => void;
}

function TaskChecklistRow({
  task,
  meta,
  labelsById,
  projectLabels,
  presets,
  otherProjects,
  unlinkedProjectId,
  pending,
  onEdit,
  onDelete,
  onMoveToProject,
  onError,
}: TaskChecklistRowProps) {
  const navigation = useTasksNavigation();
  const [threadsOpen, setThreadsOpen] = useState(false);
  const done = task.status === "done";
  const threads = meta?.threads ?? [];
  const working = (meta?.activeThreads.length ?? 0) > 0;
  const activeThreadTask = useActiveThread().taskIds.has(task.id);
  return (
    <TaskContextMenu
      task={task}
      onEdit={onEdit}
      onDelete={onDelete}
      projectLabels={projectLabels}
      otherProjects={otherProjects}
      onMoveToProject={onMoveToProject}
    >
      <div
        data-task-key={task.key}
        aria-busy={pending || undefined}
        draggable
        onDragStart={(event) => {
          event.stopPropagation();
          writeDraggedTask(event.dataTransfer, {
            taskId: task.id,
            projectId: task.projectId,
          });
        }}
        data-active-thread-task={activeThreadTask || undefined}
        className={cn(
          "-mx-1.5 rounded-md px-1.5 py-1",
          activeThreadTask && "bg-surface-selected",
          pending && "opacity-70",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            role="checkbox"
            aria-checked={done}
            aria-label={`Mark ${task.title} ${done ? "not done" : "done"}`}
            onClick={() => onEdit(task, { status: done ? "todo" : "done" })}
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm hover:bg-state-active focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <TaskCheckbox done={done} />
          </button>
          <button
            type="button"
            onClick={() => navigation.go({ kind: "task", taskKey: task.key })}
            className={cn(
              "min-w-0 flex-1 cursor-pointer truncate text-left text-sm hover:underline",
              done && "text-muted-foreground line-through",
            )}
          >
            {task.title}
          </button>
          {task.dueDate !== null ? (
            <DueDateChip
              dueDate={task.dueDate}
              onChange={(dueDate) => onEdit(task, { dueDate })}
            />
          ) : null}
          <LabelChips
            task={task}
            labelsById={labelsById}
            projectLabels={projectLabels}
            onEdit={onEdit}
          />
          <button
            type="button"
            aria-expanded={threadsOpen}
            aria-label={
              threadsOpen ? "Hide attached threads" : "Show attached threads"
            }
            onClick={() => setThreadsOpen((open) => !open)}
            className={cn(
              "flex h-5 shrink-0 cursor-pointer items-center gap-0.5 rounded px-1 text-xs tabular-nums hover:bg-state-hover",
              working ? "text-timeline-accent" : "text-subtle-foreground",
            )}
          >
            <Icon name="MessageSquare" className="size-3" />
            {threads.length > 0 ? threads.length : null}
            <Icon
              name={threadsOpen ? "ChevronUp" : "ChevronDown"}
              className="size-3"
            />
          </button>
        </div>
        {threadsOpen ? (
          <div className="ml-7 mt-1 flex flex-col gap-0.5">
            {threads.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} />
            ))}
            <div className="flex items-center gap-1">
              <NewThreadMenu
                taskId={task.id}
                presets={presets}
                onError={onError}
                unlinkedProjectId={unlinkedProjectId}
              />
              <AttachThreadPicker
                target={{ kind: "task", taskId: task.id }}
                attachedThreadIds={threads.map((thread) => thread.threadId)}
                onError={onError}
              />
            </div>
          </div>
        ) : null}
      </div>
    </TaskContextMenu>
  );
}

function AddTaskRow({
  projectId,
  onError,
}: {
  projectId: string;
  onError: (message: string) => void;
}) {
  const rpc = useTasksRpc();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const result = await rpc.call("createTask", {
        projectId,
        title: trimmed,
      });
      if (result.ok) setTitle("");
      else onError(result.error.message);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex h-7 cursor-pointer items-center gap-2 text-xs text-subtle-foreground hover:text-foreground"
      >
        <span className="flex size-5 items-center justify-center">
          <Icon name="Plus" className="size-3.5" />
        </span>
        Add task
      </button>
    );
  }
  return (
    <div className="flex h-7 items-center gap-2">
      <span className="flex size-5 items-center justify-center">
        <TaskCheckbox done={false} className="opacity-60" />
      </span>
      <input
        autoFocus
        value={title}
        disabled={busy}
        aria-label="New task title"
        placeholder="Task title…"
        className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
          if (event.key === "Escape") {
            setAdding(false);
            setTitle("");
          }
        }}
        onBlur={() => {
          if (!title.trim()) setAdding(false);
        }}
      />
    </div>
  );
}

interface TaskChecklistProps {
  projectId: string;
  projects: readonly Project[] | undefined;
  labels: readonly Label[] | undefined;
  presets: Preset[] | undefined;
  onError: (message: string) => void;
  className?: string;
}

export function TaskChecklist({
  projectId,
  projects,
  labels,
  presets,
  onError,
  className,
}: TaskChecklistProps) {
  const tasks = useProjectTasks(projectId);
  const meta = useTaskListMeta(tasks.data);
  const edits = useListTaskEdits(tasks.data, onError);
  const showCompleted = readShowCompletedTasks(useSettings().values);
  const [completedHere, setCompletedHere] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const { edit } = edits;
  const editTask = useCallback<TaskEditFn>(
    (task, patch) => {
      if (patch.status === "done") {
        setCompletedHere((current) => new Set(current).add(task.id));
      }
      edit(task, patch);
    },
    [edit],
  );
  const displayTasks = useMemo(() => {
    if (tasks.data === undefined) return undefined;
    const edited = editedTasks(tasks.data, edits.entries);
    if (showCompleted) return edited;
    return edited.filter(
      (task) => task.status !== "done" || completedHere.has(task.id),
    );
  }, [tasks.data, edits.entries, showCompleted, completedHere]);
  const projectLabels = useMemo(
    () => (labels ?? []).filter((label) => label.projectId === projectId),
    [labels, projectId],
  );
  const labelsById = useMemo(
    () => new Map(projectLabels.map((label) => [label.id, label])),
    [projectLabels],
  );
  const otherProjects = useMemo(
    () => (projects ?? []).filter((project) => project.id !== projectId),
    [projects, projectId],
  );
  const unlinkedProjectId =
    projects?.find((project) => project.id === projectId)?.linkedBbProjectId ===
    null
      ? projectId
      : null;
  const moveTask = useMoveTaskToProject(onError);

  if (displayTasks === undefined) {
    return (
      <div className={cn("flex flex-col gap-2 py-1", className)}>
        {tasks.error !== null ? (
          <span className="text-xs text-destructive">{tasks.error}</span>
        ) : (
          <>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {displayTasks.map((task) => (
        <TaskChecklistRow
          key={task.id}
          task={task}
          meta={meta.data?.get(task.id)}
          labelsById={labelsById}
          projectLabels={projectLabels}
          presets={presets}
          otherProjects={otherProjects}
          unlinkedProjectId={unlinkedProjectId}
          pending={edits.pending.has(task.id)}
          onEdit={editTask}
          onDelete={() => edits.remove(task)}
          onMoveToProject={(targetId) => moveTask(task.id, targetId)}
          onError={onError}
        />
      ))}
      <AddTaskRow projectId={projectId} onError={onError} />
    </div>
  );
}
