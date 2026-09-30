import { useState } from "react";
import type {
  Label,
  Preset,
  Project,
  SidebarProjectSummary,
} from "../../shared/contract.js";
import { ProgressBar } from "../../components/progress-bar.js";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { TaskChecklist } from "../tasks/checklist.js";
import {
  DueDateChip,
  isBareKey,
  PriorityEditor,
  ProjectContextMenu,
  StatusEditor,
  type ProjectEditFn,
} from "./property-menus.js";

interface ProjectRowProps {
  project: Project;
  summary: SidebarProjectSummary | undefined;
  labels: readonly Label[] | undefined;
  presets: Preset[] | undefined;
  onEdit: ProjectEditFn;
  onDelete: () => void;
  onOpen: () => void;
  onError: (message: string) => void;
  isLastInSection: boolean;
}

export function ProjectRow({
  project,
  summary,
  labels,
  presets,
  onEdit,
  onDelete,
  onOpen,
  onError,
  isLastInSection,
}: ProjectRowProps) {
  const [openMenu, setOpenMenu] = useState<
    "status" | "priority" | "dueDate" | null
  >(null);
  const [expanded, setExpanded] = useState(false);
  const working = (summary?.activeAgentCount ?? 0) > 0;

  return (
    <ProjectContextMenu project={project} onEdit={onEdit} onDelete={onDelete}>
      <div
        data-project-id={project.id}
        className={cn(
          "w-full text-left hover:bg-state-hover",
          !isLastInSection && "border-b border-border-hairline",
        )}
      >
        <div
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData("text/plain", project.id);
            event.dataTransfer.effectAllowed = "move";
          }}
          className="relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-1 px-3.5 py-2"
        >
          <button
            type="button"
            aria-label={`Open ${project.name}`}
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
            <StatusEditor
              status={project.status}
              onChange={(status) => onEdit(project, { status })}
              open={openMenu === "status"}
              onOpenChange={(next) => setOpenMenu(next ? "status" : null)}
              className="transition-opacity group-hover:opacity-0"
            />
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? "Hide tasks" : "Show tasks"}
              onClick={() => setExpanded((open) => !open)}
              className={cn(
                "pointer-events-none absolute inset-0 z-10 flex cursor-pointer items-center justify-center rounded-sm p-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
                working ? "text-timeline-accent" : "text-muted-foreground",
              )}
            >
              <Icon
                name={expanded ? "ChevronUp" : "ChevronDown"}
                className="size-3.5"
              />
            </button>
          </div>
          <span className="col-start-2 row-start-1 min-w-0 truncate pt-0.5 text-sm">
            {project.name}
          </span>
          <div className="col-start-2 row-start-2 flex min-w-0 items-center gap-1.5 text-xs text-subtle-foreground">
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
            <ProgressBar
              done={summary?.doneTaskCount ?? 0}
              total={summary?.taskCount ?? 0}
              active={working}
              className="ml-auto"
            />
          </div>
        </div>
        {expanded ? (
          <div className="pb-2 pl-10.5 pr-3.5">
            <TaskChecklist
              projectId={project.id}
              labels={labels}
              presets={presets}
              onError={onError}
            />
          </div>
        ) : null}
      </div>
    </ProjectContextMenu>
  );
}
