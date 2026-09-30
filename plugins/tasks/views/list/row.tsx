import { useState } from "react";
import type { Label, Task } from "../../shared/contract.js";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { TaskRowMeta } from "./data.js";
import { formatDueDate, partitionLabels } from "./lib.js";
import type { EditFn } from "./property-menus.js";
import {
  isBareKey,
  PriorityEditor,
  StatusEditor,
  TaskContextMenu,
} from "./property-menus.js";
import { isActiveThread } from "../detail/meta.js";
import { SubtaskProgressBar } from "../../components/subtask-progress-bar.js";

function LabelChip({ label }: { label: Label }) {
  return (
    <span className="flex min-w-0 max-w-32 items-center gap-1">
      <Icon
        name="Tag"
        className="size-3 shrink-0"
        style={{ color: label.color }}
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
}: {
  task: Task;
  labelsById: Map<string, Label>;
}) {
  const labels = task.labelIds.flatMap((id) => labelsById.get(id) ?? []);
  if (labels.length === 0) return null;
  return (
    <>
      <span aria-hidden>·</span>
      <span className="hidden min-w-0 items-center gap-1.5 @xl:flex">
        <LabelChipRow labels={labels} maxVisible={2} />
      </span>
      <span className="flex min-w-0 items-center gap-1.5 @xl:hidden">
        <LabelChipRow labels={labels} maxVisible={1} />
      </span>
    </>
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
  const [openMenu, setOpenMenu] = useState<"status" | "priority" | null>(null);
  const hasActiveThread = (meta?.threads ?? []).some(isActiveThread);

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
            className="absolute inset-0 rounded-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          />
          <StatusEditor
            task={task}
            onEdit={onEdit}
            open={openMenu === "status"}
            onOpenChange={(next) => setOpenMenu(next ? "status" : null)}
            className="col-start-1 row-start-1 mt-0.5"
          />
          <span className="col-start-2 row-start-1 min-w-0 truncate text-sm">
            {task.title}
          </span>
          <div className="col-start-2 row-start-2 flex min-w-0 items-center gap-1.5 text-xs text-subtle-foreground">
            <PriorityEditor
              task={task}
              onEdit={onEdit}
              open={openMenu === "priority"}
              onOpenChange={(next) => setOpenMenu(next ? "priority" : null)}
            />
            {task.dueDate !== null ? (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">
                  {formatDueDate(task.dueDate)}
                </span>
              </>
            ) : null}
            <LabelChips task={task} labelsById={labelsById} />
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
        </div>
      </div>
    </TaskContextMenu>
  );
}
