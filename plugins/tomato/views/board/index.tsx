import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type {
  Project,
  ProjectStatus,
  SidebarProjectSummary,
} from "../../shared/contract.js";
import { useProjects } from "../../shell/data.js";
import { useTasksNavigation } from "../../shell/routes.js";
import { sortItems } from "../../shared/sort.js";
import { NewProjectDialog } from "../manage/new-project-dialog.js";
import { DetailToasts, useDetailToasts } from "../detail/toast.js";
import { useProjectSummaries } from "../list/data.js";
import { PriorityTag, StatusIcon } from "../list/icons.js";
import { formatDueDate, STATUS_LABELS } from "../list/lib.js";
import { useProjectEdits } from "../list/use-project-edits.js";
import {
  applyBoardMove,
  BOARD_STATUSES,
  dropIndexForPointer,
  dropNeighborsForIndex,
  emptyColumns,
  visibleBoardStatuses,
  type BoardColumns,
} from "./drop-position.js";
import { ProgressBar } from "../../components/progress-bar.js";
import { Button } from "@/components/ui/button";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const DRAG_THRESHOLD_PX = 5;

function groupColumns(projects: readonly Project[]): BoardColumns<Project> {
  const columns = emptyColumns<Project>();
  for (const project of sortItems(projects, "manual")) {
    columns[project.status].push(project);
  }
  return columns;
}

interface DragState {
  projectId: string;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  overStatus: ProjectStatus | null;
  dropIndex: number;
}

interface ProjectCardProps {
  project: Project;
  summary: SidebarProjectSummary | undefined;
  ghost?: boolean;
  dragging?: boolean;
  cardRef?: (element: HTMLDivElement | null) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onClick?: () => void;
}

function ProjectCard({
  project,
  summary,
  ghost = false,
  dragging = false,
  cardRef,
  onPointerDown,
  onClick,
}: ProjectCardProps) {
  const working = (summary?.activeAgentCount ?? 0) > 0;
  const done = summary?.doneTaskCount ?? 0;
  const total = summary?.taskCount ?? 0;
  return (
    <div
      ref={cardRef}
      data-project-id={project.id}
      role="button"
      tabIndex={ghost ? -1 : 0}
      aria-label={`Open ${project.name}`}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick?.();
        }
      }}
      className={cn(
        "shrink-0 rounded-lg border border-border bg-card px-2.5 py-2 shadow-2xs select-none",
        ghost
          ? "rotate-2 shadow-md"
          : "cursor-pointer touch-none hover:border-input",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-1.5">
        <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug font-medium">
          {project.name}
        </span>
        {working ? (
          <Icon
            name="RotateCcw"
            aria-label="Agent working"
            className="mt-0.5 size-3 shrink-0 animate-spin text-timeline-accent"
          />
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-subtle-foreground">
        <PriorityTag priority={project.priority} />
        {project.dueDate !== null ? (
          <span className="flex h-5 items-center gap-1 rounded-md border border-border px-1.5 tabular-nums">
            <Icon name="Clock" className="size-3 shrink-0" />
            {formatDueDate(project.dueDate)}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-subtle-foreground">
        <ProgressBar done={done} total={total} active={working} />
        <span className="ml-auto tabular-nums">
          {done}/{total}
        </span>
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <DelayedLoading>
      <div className="flex h-full items-start gap-3 overflow-x-auto p-4">
        {BOARD_STATUSES.map((status) => (
          <div
            key={status}
            className="flex w-[230px] shrink-0 flex-col gap-2 p-1"
          >
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </DelayedLoading>
  );
}

export function BoardView({ activeOnly = false }: { activeOnly?: boolean }) {
  const navigation = useTasksNavigation();
  const projects = useProjects();
  const summaries = useProjectSummaries();
  const { toasts, push, dismiss } = useDetailToasts();
  const edits = useProjectEdits(projects.data, push);

  const serverColumns = useMemo(() => {
    if (edits.projects === undefined) return undefined;
    return groupColumns(
      activeOnly
        ? edits.projects.filter(
            (project) => (summaries.get(project.id)?.activeAgentCount ?? 0) > 0,
          )
        : edits.projects,
    );
  }, [edits.projects, activeOnly, summaries]);
  const [columns, setColumns] = useState<BoardColumns<Project> | undefined>(
    undefined,
  );
  useEffect(() => {
    setColumns(serverColumns);
  }, [serverColumns]);
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const [drag, setDrag] = useState<DragState | null>(null);
  const [quickAddStatus, setQuickAddStatus] = useState<ProjectStatus | null>(
    null,
  );
  const boardRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef(new Map<ProjectStatus, HTMLDivElement>());
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const suppressClickRef = useRef(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const findDropTarget = (
    x: number,
    y: number,
    draggedId: string,
  ): { status: ProjectStatus; index: number } | null => {
    const current = columnsRef.current;
    if (!current) return null;
    const boardRect = boardRef.current?.getBoundingClientRect();
    if (
      boardRect &&
      (y < boardRect.top - 24 ||
        y > boardRect.bottom + 24 ||
        x < boardRect.left ||
        x > boardRect.right)
    ) {
      return null;
    }
    for (const status of visibleBoardStatuses(current)) {
      const columnElement = columnRefs.current.get(status);
      if (!columnElement) continue;
      const rect = columnElement.getBoundingClientRect();
      if (x < rect.left - 6 || x > rect.right + 6) continue;
      const centers = current[status]
        .filter((project) => project.id !== draggedId)
        .map((project) => {
          const cardElement = cardRefs.current.get(project.id);
          if (!cardElement) return Number.NEGATIVE_INFINITY;
          const cardRect = cardElement.getBoundingClientRect();
          return cardRect.top + cardRect.height / 2;
        });
      return { status, index: dropIndexForPointer(centers, y) };
    }
    return null;
  };

  const commitDrop = (
    projectId: string,
    toStatus: ProjectStatus,
    dropIndex: number,
  ) => {
    const current = columnsRef.current;
    if (!current) return;
    const project = Object.values(current)
      .flat()
      .find((entry) => entry.id === projectId);
    if (!project) return;
    const column = current[toStatus];
    const neighbors = dropNeighborsForIndex(
      column.map((entry) => entry.id),
      projectId,
      dropIndex,
    );
    const byId = new Map(column.map((entry) => [entry.id, entry]));
    setColumns(applyBoardMove(current, projectId, toStatus, dropIndex));
    edits.move(
      project,
      toStatus,
      neighbors.beforeId === null ? undefined : byId.get(neighbors.beforeId),
      neighbors.afterId === null ? undefined : byId.get(neighbors.afterId),
    );
  };

  const handleCardPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    project: Project,
  ) => {
    if (event.button !== 0 || dragCleanupRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const start = {
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
    };
    let active = false;

    const updateDrag = (moveEvent: PointerEvent) => {
      const target = findDropTarget(
        moveEvent.clientX,
        moveEvent.clientY,
        project.id,
      );
      setDrag({
        projectId: project.id,
        x: moveEvent.clientX,
        y: moveEvent.clientY,
        offsetX: start.offsetX,
        offsetY: start.offsetY,
        width: start.width,
        overStatus: target?.status ?? null,
        dropIndex: target?.index ?? 0,
      });
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (!active) {
        const distance = Math.hypot(
          moveEvent.clientX - start.x,
          moveEvent.clientY - start.y,
        );
        if (distance < DRAG_THRESHOLD_PX) return;
        active = true;
      }
      moveEvent.preventDefault();
      updateDrag(moveEvent);
    };
    const finish = (upEvent: PointerEvent | null) => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      if (!active) return;
      if (upEvent) {
        const target = findDropTarget(
          upEvent.clientX,
          upEvent.clientY,
          project.id,
        );
        if (target) commitDrop(project.id, target.status, target.index);
      }
      setDrag(null);
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };
    const onUp = (upEvent: PointerEvent) => finish(upEvent);
    const onCancel = () => finish(null);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    dragCleanupRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  };

  const openProject = (project: Project) => {
    if (suppressClickRef.current) return;
    navigation.go({ kind: "project", projectId: project.id });
  };

  if (columns === undefined) {
    if (projects.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
          <p>Failed to load the board: {projects.error}</p>
          <Button variant="outline" size="sm" onClick={projects.refresh}>
            Retry
          </Button>
        </div>
      );
    }
    return <BoardSkeleton />;
  }

  const ghostProject = drag
    ? Object.values(columns)
        .flat()
        .find((project) => project.id === drag.projectId)
    : undefined;

  const renderColumn = (status: ProjectStatus) => {
    const cards = columns[status];
    const isDragOver = drag !== null && drag.overStatus === status;
    const remaining = drag
      ? cards.filter((project) => project.id !== drag.projectId)
      : cards;
    const indicatorBeforeId = isDragOver
      ? (remaining[drag.dropIndex]?.id ?? null)
      : undefined;
    const indicator = (
      <div
        key="drop-indicator"
        className="h-0.5 shrink-0 rounded-full bg-primary"
      />
    );
    const children: ReactNode[] = [];
    for (const project of cards) {
      if (project.id === indicatorBeforeId) children.push(indicator);
      children.push(
        <ProjectCard
          key={project.id}
          project={project}
          summary={summaries.get(project.id)}
          dragging={drag?.projectId === project.id}
          cardRef={(element) => {
            if (element) cardRefs.current.set(project.id, element);
            else cardRefs.current.delete(project.id);
          }}
          onPointerDown={(event) => handleCardPointerDown(event, project)}
          onClick={() => openProject(project)}
        />,
      );
    }
    if (indicatorBeforeId === null) children.push(indicator);

    return (
      <div
        key={status}
        data-board-column-header={status}
        className="flex max-h-full w-[230px] shrink-0 flex-col"
      >
        <div className="flex items-center gap-1.5 px-1 pb-2 text-sm font-semibold">
          <StatusIcon status={status} />
          <span>{STATUS_LABELS[status]}</span>
          <span className="font-normal text-muted-foreground">
            {cards.length}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-6 text-muted-foreground"
            aria-label={`New ${STATUS_LABELS[status]} project`}
            onClick={() => setQuickAddStatus(status)}
          >
            <Icon name="Plus" className="size-3.5" />
          </Button>
        </div>
        <div
          ref={(element) => {
            if (element) columnRefs.current.set(status, element);
            else columnRefs.current.delete(status);
          }}
          data-board-column={status}
          className={cn(
            "flex min-h-16 flex-col gap-2 overflow-y-auto rounded-lg p-1",
            isDragOver &&
              "bg-surface-selected outline-2 outline-dashed outline-input",
          )}
        >
          {children}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={boardRef}
      className={cn(
        "flex h-full items-start gap-3 overflow-x-auto p-4",
        drag !== null && "cursor-grabbing",
      )}
    >
      {visibleBoardStatuses(columns).map(renderColumn)}
      {drag && ghostProject ? (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: drag.x - drag.offsetX,
            top: drag.y - drag.offsetY,
            width: drag.width,
          }}
        >
          <ProjectCard
            project={ghostProject}
            summary={summaries.get(ghostProject.id)}
            ghost
          />
        </div>
      ) : null}
      <NewProjectDialog
        open={quickAddStatus !== null}
        onOpenChange={(open) => {
          if (!open) setQuickAddStatus(null);
        }}
        defaultStatus={quickAddStatus ?? undefined}
      />
      <DetailToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
