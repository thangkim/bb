import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import Tag01Icon from "@hugeicons/core-free-icons/Tag01Icon";
import type { Label, Task, TaskThread } from "../../shared/contract.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { TaskRowMeta } from "./data.js";
import {
  DUE_DATE_PRESETS,
  formatDueDate,
  localIsoDate,
  partitionLabels,
} from "./lib.js";
import type { EditFn } from "./property-menus.js";
import {
  isBareKey,
  PriorityEditor,
  StatusEditor,
  TaskContextMenu,
} from "./property-menus.js";
import { isActiveThread, THREAD_STATUS_META } from "../detail/meta.js";
import { SubtaskProgressBar } from "../../components/subtask-progress-bar.js";
import { useOpenThreadInSplit } from "../../components/use-open-thread-in-split.js";

function LabelChip({ label }: { label: Label }) {
  return (
    <span className="flex min-w-0 max-w-32 items-center gap-1 rounded-md border border-border px-1.5 py-px">
      <HugeiconsIcon
        icon={Tag01Icon}
        className="size-3 shrink-0 text-muted-foreground"
      />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

function LabelChipRow({
  labels,
  maxVisible,
}: {
  labels: readonly Label[];
  maxVisible: number;
}) {
  const { visible, hidden } = partitionLabels(labels, maxVisible);
  return (
    <>
      {visible.map((label, index) => (
        <span key={label.id} className="flex min-w-0 items-center gap-1.5">
          {index > 0 ? <span aria-hidden>,</span> : null}
          <LabelChip label={label} />
        </span>
      ))}
      {hidden.length > 0 ? (
        <span
          title={hidden.map((label) => label.name).join(", ")}
          className="tabular-nums"
        >
          +{hidden.length}
        </span>
      ) : null}
    </>
  );
}

function LabelChips({
  task,
  labelsById,
  projectLabels,
  onEdit,
  open,
  onOpenChange,
}: {
  task: Task;
  labelsById: Map<string, Label>;
  projectLabels: readonly Label[];
  onEdit: EditFn;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const labels = task.labelIds.flatMap((id) => labelsById.get(id) ?? []);
  if (labels.length === 0) return null;
  const toggleLabel = (labelId: string) => {
    const labelIds = task.labelIds.includes(labelId)
      ? task.labelIds.filter((id) => id !== labelId)
      : [...task.labelIds, labelId];
    onEdit(task, { labelIds });
  };
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Edit labels"
          className="relative z-10 flex min-w-0 items-center gap-1.5 hover:text-foreground"
        >
          <span className="hidden min-w-0 items-center gap-1.5 @xl:flex">
            <LabelChipRow labels={labels} maxVisible={2} />
          </span>
          <span className="flex min-w-0 items-center gap-1.5 @xl:hidden">
            <LabelChipRow labels={labels} maxVisible={1} />
          </span>
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

function DueDateChip({
  task,
  onEdit,
  open,
  onOpenChange,
}: {
  task: Task;
  onEdit: EditFn;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (task.dueDate === null) return null;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Change due date, currently ${formatDueDate(task.dueDate)}`}
          className="relative z-10 flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-px tabular-nums hover:border-input hover:text-foreground"
        >
          <Icon name="Clock" className="size-3 shrink-0" />
          {formatDueDate(task.dueDate)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {DUE_DATE_PRESETS.map(([label, days]) => {
          const value = localIsoDate(days);
          return (
            <DropdownMenuItem
              key={label}
              onSelect={() => onEdit(task, { dueDate: value })}
            >
              <span>{label}</span>
              <span className="ml-auto text-2xs text-subtle-foreground">
                {formatDueDate(value)}
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onEdit(task, { dueDate: null })}>
          <Icon name="X" className="size-3.5" />
          <span>No due date</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThreadRow({ thread }: { thread: TaskThread }) {
  const openThread = useOpenThreadInSplit();
  const statusMeta = THREAD_STATUS_META[thread.liveStatus];
  const working = isActiveThread(thread);
  return (
    <button
      type="button"
      aria-label={`${thread.title} — ${statusMeta.label}`}
      onClick={() => openThread(thread.threadId)}
      className="relative z-10 flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs text-subtle-foreground hover:bg-state-hover"
    >
      <Icon name="MessageSquare" className="size-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{thread.title}</span>
      {working ? (
        <Icon
          name="RotateCcw"
          className="size-3 shrink-0 animate-spin text-timeline-accent"
        />
      ) : null}
    </button>
  );
}

interface TaskRowProps {
  task: Task;
  meta: TaskRowMeta | undefined;
  labelsById: Map<string, Label>;
  projectLabels: readonly Label[];
  onEdit: EditFn;
  onDelete: () => void;
  onOpen: () => void;
  pending: boolean;
  isLastInSection: boolean;
}

export function TaskRow({
  task,
  meta,
  labelsById,
  projectLabels,
  onEdit,
  onDelete,
  onOpen,
  pending,
  isLastInSection,
}: TaskRowProps) {
  const [openMenu, setOpenMenu] = useState<
    "status" | "priority" | "dueDate" | "labels" | null
  >(null);
  const [threadsExpanded, setThreadsExpanded] = useState(false);
  const threads = meta?.threads ?? [];
  const hasThreads = threads.length > 0;
  const hasActiveThread = threads.some(isActiveThread);

  return (
    <TaskContextMenu
      task={task}
      onEdit={onEdit}
      onDelete={onDelete}
      projectLabels={projectLabels}
    >
      <div
        data-task-key={task.key}
        aria-busy={pending || undefined}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", task.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        className={cn(
          !isLastInSection && "border-b border-border-hairline",
          pending && "opacity-70",
        )}
      >
        <div
          className={cn(
            "relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-1 px-3.5 py-2 text-left transition-opacity hover:bg-state-hover",
          )}
        >
          <button
            type="button"
            aria-label={`Open ${task.key}: ${task.title}`}
            onClick={onOpen}
            onKeyDown={(event) => {
              if (!isBareKey(event)) return;
              const key = event.key.toLowerCase();
              if (key === "s") {
                event.preventDefault();
                setOpenMenu("status");
              } else if (key === "p") {
                event.preventDefault();
                setOpenMenu("priority");
              }
            }}
            className="absolute inset-0 cursor-pointer rounded-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          />
          <div className="group relative col-start-1 row-start-1 mt-0.5 size-5 shrink-0">
            <div className={cn(hasThreads && "group-hover:opacity-0")}>
              <StatusEditor
                task={task}
                onEdit={onEdit}
                open={openMenu === "status"}
                onOpenChange={(next) => setOpenMenu(next ? "status" : null)}
              />
            </div>
            {hasThreads ? (
              <button
                type="button"
                aria-expanded={threadsExpanded}
                aria-label={
                  threadsExpanded ? "Hide attached threads" : "Show attached threads"
                }
                title={`${threads.length} attached thread${threads.length === 1 ? "" : "s"}`}
                onClick={() => setThreadsExpanded((current) => !current)}
                className="pointer-events-none absolute inset-0 z-10 flex cursor-pointer items-center justify-center rounded-sm p-0 opacity-0 hover:bg-state-active group-hover:pointer-events-auto group-hover:opacity-100"
              >
                <Icon
                  name="ChevronDown"
                  className={cn(
                    "size-3.5 transition-transform",
                    threadsExpanded && "rotate-180",
                    hasActiveThread && "text-timeline-accent",
                  )}
                />
              </button>
            ) : null}
          </div>
          <span className="col-start-2 row-start-1 min-w-0 truncate pt-0.5 text-sm">
            {task.title}
          </span>
          <div className="col-start-2 row-start-2 flex min-w-0 items-center gap-1.5 text-xs text-subtle-foreground">
            <PriorityEditor
              task={task}
              onEdit={onEdit}
              open={openMenu === "priority"}
              onOpenChange={(next) => setOpenMenu(next ? "priority" : null)}
            />
            <DueDateChip
              task={task}
              onEdit={onEdit}
              open={openMenu === "dueDate"}
              onOpenChange={(next) => setOpenMenu(next ? "dueDate" : null)}
            />
            <LabelChips
              task={task}
              labelsById={labelsById}
              projectLabels={projectLabels}
              onEdit={onEdit}
              open={openMenu === "labels"}
              onOpenChange={(next) => setOpenMenu(next ? "labels" : null)}
            />
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {meta ? (
                <SubtaskProgressBar
                  done={meta.subtaskDone}
                  total={meta.subtaskTotal}
                  active={hasActiveThread}
                />
              ) : null}
            </span>
          </div>
          {threadsExpanded && hasThreads ? (
            <div className="col-start-2 row-start-3 flex flex-col gap-0.5 pt-4">
              {threads.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </TaskContextMenu>
  );
}
