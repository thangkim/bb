import { useState, type ReactNode } from "react";
import {
  PROJECT_STATUSES,
  type Label,
  type Priority,
  type Project,
  type ProjectStatus,
  type Task,
} from "../../shared/contract.js";
import { ConfirmDialog } from "../../components/confirm-dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { TaskEdit } from "./optimistic.js";
import { PriorityIcon, PriorityTag, StatusIcon, TaskCheckbox } from "./icons.js";
import {
  DUE_DATE_PRESETS,
  formatDueDate,
  localIsoDate,
  PRIORITY_LABELS,
  STATUS_LABELS,
} from "./lib.js";

export interface ProjectEdit {
  status?: ProjectStatus;
  priority?: Priority;
  dueDate?: string | null;
}

export type ProjectEditFn = (project: Project, patch: ProjectEdit) => void;
export type TaskEditFn = (task: Task, patch: TaskEdit) => void;

export const PRIORITY_MENU_ORDER: readonly Priority[] = [
  "none",
  "urgent",
  "high",
  "medium",
  "low",
];

export function priorityForShortcut(key: string): Priority | null {
  if (!/^[0-9]$/.test(key)) return null;
  const index = Number(key);
  return index >= 0 && index < PRIORITY_MENU_ORDER.length
    ? (PRIORITY_MENU_ORDER[index] ?? null)
    : null;
}

export function isBareKey(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

function MenuHeading({ label, shortcut }: { label: string; shortcut: string }) {
  return (
    <DropdownMenuLabel className="flex items-center gap-2">
      <span className="flex-1">{label}</span>
      <span className="w-3 text-right text-2xs tabular-nums text-subtle-foreground">
        {shortcut}
      </span>
    </DropdownMenuLabel>
  );
}

function PickerOption({
  icon,
  label,
  active,
  shortcut,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  shortcut: number;
}) {
  return (
    <>
      <span className="flex flex-1 items-center gap-2">
        {icon}
        {label}
        {active ? <span className="sr-only"> (current)</span> : null}
      </span>
      <span
        aria-hidden
        className="flex w-4 items-center justify-center text-subtle-foreground"
      >
        {active ? <Icon name="Check" className="size-3.5" /> : null}
      </span>
      <span
        aria-hidden
        className="w-3 text-right text-2xs tabular-nums text-subtle-foreground"
      >
        {shortcut}
      </span>
    </>
  );
}

const PRIORITY_TRIGGER_CLASS =
  "relative z-10 inline-flex h-5 shrink-0 items-center rounded-md hover:opacity-75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:opacity-75 max-md:pointer-coarse:h-8";

export const CHIP_TRIGGER_CLASS =
  "relative z-10 flex h-5 shrink-0 items-center gap-1 rounded-md border border-border px-1.5 text-xs text-subtle-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:text-foreground";

export function PriorityEditor({
  priority,
  onChange,
  open,
  onOpenChange,
  className,
}: {
  priority: Priority;
  onChange: (priority: Priority) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}) {
  const select = (next: Priority) => {
    if (next !== priority) onChange(next);
  };
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Set priority, currently ${PRIORITY_LABELS[priority]}`}
          className={cn(PRIORITY_TRIGGER_CLASS, className)}
        >
          <PriorityTag priority={priority} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-52"
        mobileTitle="Set priority"
        onKeyDown={(event) => {
          const shortcut = priorityForShortcut(event.key);
          if (shortcut !== null && isBareKey(event)) {
            event.preventDefault();
            select(shortcut);
            onOpenChange(false);
          }
        }}
      >
        <MenuHeading label="Set priority to…" shortcut="P" />
        {PRIORITY_MENU_ORDER.map((option, index) => (
          <DropdownMenuItem
            key={option}
            aria-current={option === priority ? "true" : undefined}
            onSelect={() => select(option)}
          >
            <PickerOption
              icon={<PriorityIcon priority={option} />}
              label={PRIORITY_LABELS[option]}
              active={option === priority}
              shortcut={index}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DueDateChip({
  dueDate,
  onChange,
  open,
  onOpenChange,
  className,
}: {
  dueDate: string | null;
  onChange: (dueDate: string | null) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  return (
    <DropdownMenu
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={
            dueDate === null
              ? "Set due date"
              : `Change due date, currently ${formatDueDate(dueDate)}`
          }
          className={cn(CHIP_TRIGGER_CLASS, "tabular-nums", className)}
        >
          <Icon name="Clock" className="size-3 shrink-0" />
          {dueDate === null ? null : formatDueDate(dueDate)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-44"
        mobileTitle="Due date"
      >
        {DUE_DATE_PRESETS.map(([label, days]) => {
          const value = localIsoDate(days);
          return (
            <DropdownMenuItem key={label} onSelect={() => onChange(value)}>
              <span>{label}</span>
              <span className="ml-auto text-2xs text-subtle-foreground">
                {formatDueDate(value)}
              </span>
            </DropdownMenuItem>
          );
        })}
        {dueDate !== null ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(null)}>
              <Icon name="X" className="size-3.5" />
              <span>No due date</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DueDateSubmenu({
  dueDate,
  onChange,
}: {
  dueDate: string | null;
  onChange: (dueDate: string | null) => void;
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Icon name="Clock" className="size-3.5" />
        <span>Due date</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-44">
        {DUE_DATE_PRESETS.map(([label, days]) => {
          const value = localIsoDate(days);
          return (
            <ContextMenuItem key={label} onSelect={() => onChange(value)}>
              <span>{label}</span>
              <span className="ml-auto text-2xs text-subtle-foreground">
                {formatDueDate(value)}
              </span>
            </ContextMenuItem>
          );
        })}
        {dueDate !== null ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onChange(null)}>
              <Icon name="X" className="size-3.5" />
              <span>No due date</span>
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

export function ProjectContextMenu({
  project,
  onEdit,
  onDelete,
  children,
}: {
  project: Project;
  onEdit: ProjectEditFn;
  onDelete: () => void;
  children: ReactNode;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <StatusIcon status={project.status} />
            <span>Status</span>
            <ContextMenuShortcut>S</ContextMenuShortcut>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-48">
            {PROJECT_STATUSES.map((status) => (
              <ContextMenuItem
                key={status}
                aria-current={status === project.status ? "true" : undefined}
                onSelect={() => {
                  if (status !== project.status) onEdit(project, { status });
                }}
              >
                <span className="flex flex-1 items-center gap-2">
                  <StatusIcon status={status} />
                  {STATUS_LABELS[status]}
                </span>
                {status === project.status ? (
                  <Icon name="Check" aria-hidden className="size-3.5" />
                ) : null}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <PriorityIcon priority={project.priority} />
            <span>Priority</span>
            <ContextMenuShortcut>P</ContextMenuShortcut>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-44">
            {PRIORITY_MENU_ORDER.map((priority) => (
              <ContextMenuItem
                key={priority}
                aria-current={
                  priority === project.priority ? "true" : undefined
                }
                onSelect={() => {
                  if (priority !== project.priority) {
                    onEdit(project, { priority });
                  }
                }}
              >
                <span className="flex flex-1 items-center gap-2">
                  <PriorityIcon priority={priority} />
                  {PRIORITY_LABELS[priority]}
                </span>
                {priority === project.priority ? (
                  <Icon name="Check" aria-hidden className="size-3.5" />
                ) : null}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <DueDateSubmenu
          dueDate={project.dueDate}
          onChange={(dueDate) => onEdit(project, { dueDate })}
        />

        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => setConfirmDelete(true)}
        >
          <Icon name="Trash2" className="size-3.5" />
          <span>Delete project</span>
        </ContextMenuItem>
      </ContextMenuContent>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete project?"
        description={`"${project.name}" and all of its tasks will be permanently deleted, including their attachments and comments. This can't be undone.`}
        confirmLabel="Delete"
        onConfirm={onDelete}
      />
    </ContextMenu>
  );
}

export function TaskContextMenu({
  task,
  onEdit,
  onDelete,
  projectLabels,
  otherProjects,
  onMoveToProject,
  children,
}: {
  task: Task;
  onEdit: TaskEditFn;
  onDelete: () => void;
  projectLabels: readonly Label[];
  otherProjects: readonly Project[];
  onMoveToProject: (projectId: string) => void;
  children: ReactNode;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const done = task.status === "done";
  const toggleLabel = (labelId: string) => {
    const labelIds = task.labelIds.includes(labelId)
      ? task.labelIds.filter((id) => id !== labelId)
      : [...task.labelIds, labelId];
    onEdit(task, { labelIds });
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        <ContextMenuItem
          onSelect={() => onEdit(task, { status: done ? "todo" : "done" })}
        >
          <TaskCheckbox done={!done} />
          <span>{done ? "Mark as not done" : "Mark as done"}</span>
        </ContextMenuItem>

        <DueDateSubmenu
          dueDate={task.dueDate}
          onChange={(dueDate) => onEdit(task, { dueDate })}
        />

        {projectLabels.length > 0 ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Icon name="ListTodo" className="size-3.5" />
              <span>Labels</span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-48">
              {projectLabels.map((label) => (
                <ContextMenuCheckboxItem
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
                </ContextMenuCheckboxItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : null}

        {otherProjects.length > 0 ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Icon name="ArrowRight" className="size-3.5" />
              <span>Move to project</span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-48">
              {otherProjects.map((project) => (
                <ContextMenuItem
                  key={project.id}
                  onSelect={() => onMoveToProject(project.id)}
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className="truncate">{project.name}</span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : null}

        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => setConfirmDelete(true)}
        >
          <Icon name="Trash2" className="size-3.5" />
          <span>Delete task</span>
        </ContextMenuItem>
      </ContextMenuContent>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete task?"
        description={`"${task.title}" will be permanently deleted, including its attachments and comments. This can't be undone.`}
        confirmLabel="Delete"
        onConfirm={onDelete}
      />
    </ContextMenu>
  );
}
