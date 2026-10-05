import { useState } from "react";
import type {
  Label,
  Preset,
  Project,
  ProjectThread,
  SidebarProjectSummary,
} from "../../shared/contract.js";
import { ProgressBar } from "../../components/progress-bar.js";
import { useActiveThread } from "../../components/active-thread.js";
import { Icon } from "@/components/ui/icon";
import { TaskCheckbox } from "./icons.js";
import { cn } from "@/lib/utils";
import { TaskChecklist } from "../tasks/checklist.js";
import {
  ProjectThreadActions,
  ProjectThreadLinks,
} from "../tasks/project-threads.js";
import {
  isTaskDrag,
  PROJECT_DRAG_TYPE,
  readDraggedTask,
} from "../tasks/move-task.js";
import {
  DueDateChip,
  isBareKey,
  PriorityEditor,
  ProjectContextMenu,
  type ProjectEditFn,
} from "./property-menus.js";

interface ProjectRowProps {
  project: Project;
  projects: readonly Project[] | undefined;
  summary: SidebarProjectSummary | undefined;
  labels: readonly Label[] | undefined;
  presets: Preset[] | undefined;
  threads: readonly ProjectThread[];
  threadsError: string | null;
  busyThreadIds: ReadonlySet<string>;
  onEdit: ProjectEditFn;
  onComplete: () => void;
  onDelete: () => void;
  onOpen: () => void;
  onMoveTaskHere: (taskId: string) => void;
  onError: (message: string) => void;
  isLastInSection: boolean;
}

export function ProjectRow({
  project,
  projects,
  summary,
  labels,
  presets,
  threads,
  threadsError,
  busyThreadIds,
  onEdit,
  onComplete,
  onDelete,
  onOpen,
  onMoveTaskHere,
  onError,
  isLastInSection,
}: ProjectRowProps) {
  const [taskDragOver, setTaskDragOver] = useState(false);
  const [openMenu, setOpenMenu] = useState<"priority" | "dueDate" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const working = (summary?.activeAgentCount ?? 0) > 0;
  const done = project.status === "done";
  const activeThreadProject = useActiveThread().projectIds.has(project.id);

  return (
    <ProjectContextMenu project={project} onEdit={onEdit} onDelete={onDelete}>
      <div
        data-project-id={project.id}
        data-task-drop-target={taskDragOver || undefined}
        data-active-thread-project={activeThreadProject || undefined}
        onDragOver={(event) => {
          if (!isTaskDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setTaskDragOver(true);
        }}
        onDragLeave={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) {
            return;
          }
          setTaskDragOver(false);
        }}
        onDrop={(event) => {
          const dragged = readDraggedTask(event.dataTransfer);
          if (dragged === null) return;
          event.preventDefault();
          event.stopPropagation();
          setTaskDragOver(false);
          if (dragged.projectId !== project.id) onMoveTaskHere(dragged.taskId);
        }}
        className={cn(
          "group/project relative w-full text-left",
          activeThreadProject ? "bg-surface-selected" : "hover:bg-state-hover",
          !isLastInSection && "border-b border-border-hairline",
          taskDragOver &&
            "bg-surface-selected outline-2 -outline-offset-2 outline-dashed outline-input",
        )}
      >
        {activeThreadProject ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-timeline-accent"
          />
        ) : null}
        <div
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(PROJECT_DRAG_TYPE, project.id);
            event.dataTransfer.effectAllowed = "move";
          }}
          className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 px-3.5 py-2"
        >
          <button
            type="button"
            aria-label={`Open ${project.name}`}
            onClick={onOpen}
            onKeyDown={(event) => {
              if (!isBareKey(event)) return;
              if (event.key.toLowerCase() === "p") {
                event.preventDefault();
                setOpenMenu("priority");
              }
            }}
            className="absolute inset-0 cursor-pointer rounded-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          />
          <button
            type="button"
            role="checkbox"
            aria-checked={done}
            aria-label={`Mark ${project.name} ${done ? "not done" : "done"}`}
            onClick={() =>
              done ? onEdit(project, { status: "todo" }) : onComplete()
            }
            className="relative z-10 col-start-1 row-start-1 mt-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm p-0 hover:bg-state-active focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <TaskCheckbox done={done} />
          </button>
          <span className="col-start-2 row-start-1 min-w-0 truncate pt-0.5 text-sm">
            {project.name}
          </span>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? "Hide tasks" : "Show tasks"}
            onClick={() => setExpanded((open) => !open)}
            className={cn(
              "relative z-10 col-start-3 row-start-1 mt-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm p-0 transition-opacity hover:bg-state-active focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/project:opacity-100 pointer-coarse:opacity-100",
              working ? "text-timeline-accent" : "text-muted-foreground",
              !expanded && "opacity-0",
            )}
          >
            <Icon
              name={expanded ? "ChevronUp" : "ChevronDown"}
              className="size-3.5"
            />
          </button>
          <div className="col-span-2 col-start-2 row-start-2 flex min-w-0 items-center gap-1.5 text-xs text-subtle-foreground">
            <PriorityEditor
              priority={project.priority}
              onChange={(priority) => onEdit(project, { priority })}
              open={openMenu === "priority"}
              onOpenChange={(next) => setOpenMenu(next ? "priority" : null)}
            />
            <DueDateChip
              dueDate={project.dueDate}
              onChange={(dueDate) => onEdit(project, { dueDate })}
              open={openMenu === "dueDate"}
              onOpenChange={(next) => setOpenMenu(next ? "dueDate" : null)}
            />
            <ProjectThreadActions
              projectId={project.id}
              linked={project.linkedBbProjectId !== null}
              threads={threads}
              presets={presets}
              onError={onError}
              compact
              className="gap-0.5"
            />
            <ProgressBar
              done={summary?.doneTaskCount ?? 0}
              total={summary?.taskCount ?? 0}
              active={working}
              className="ml-auto"
            />
          </div>
        </div>
        {threads.length > 0 || threadsError !== null || expanded ? (
          <div className="pb-2 pl-10.5 pr-3.5">
            {threads.length > 0 || threadsError !== null ? (
              <ProjectThreadLinks
                projectId={project.id}
                threads={threads}
                error={threadsError}
                busyThreadIds={busyThreadIds}
                className={
                  expanded
                    ? "mb-1 border-b border-border-hairline pb-1.5"
                    : undefined
                }
              />
            ) : null}
            {expanded ? (
              <TaskChecklist
                projectId={project.id}
                projects={projects}
                labels={labels}
                presets={presets}
                onError={onError}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </ProjectContextMenu>
  );
}
