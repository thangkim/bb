import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectStatus, ProjectThread } from "../../shared/contract.js";
import { useProjects } from "../../shell/data.js";
import { useTasksNavigation } from "../../shell/routes.js";
import { NewProjectDialog } from "../manage/new-project-dialog.js";
import { DetailToasts, useDetailToasts } from "../detail/toast.js";
import { EmptyState } from "../../components/empty-state.js";
import { Button } from "@/components/ui/button";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { sortItems } from "../../shared/sort.js";
import type { TaskSort } from "../../shared/pagination.js";
import {
  useLabels,
  useProjectSummaries,
  useProjectThreadsByProject,
} from "./data.js";
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  ListFilterBar,
  type ListFilterState,
} from "./filter-bar.js";
import {
  loadListPreference,
  storeListPreference,
  type ListPreference,
} from "./list-preference.js";
import {
  listScrollScopeKey,
  useListScrollRestoration,
} from "./scroll-restoration.js";
import { groupProjectsByStatus, STATUS_LABELS } from "./lib.js";
import { useProjectEdits } from "./use-project-edits.js";
import { ProjectRow } from "./row.js";
import { PROJECT_DRAG_TYPE, useMoveTaskToProject } from "../tasks/move-task.js";
import {
  useBusyThreadIds,
  useUnarchivedThreadIds,
} from "../tasks/project-threads.js";

const NO_THREADS: readonly ProjectThread[] = [];

interface ListViewProps {
  activeOnly?: boolean;
}

function LoadingRows() {
  return (
    <DelayedLoading>
      <div className="px-3.5 pt-3">
        <Skeleton className="mb-3 h-4 w-28" />
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="flex h-[52px] flex-col justify-center gap-2 border-b border-border-hairline"
          >
            <div className="flex items-center gap-2">
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <Skeleton className="ml-5.5 h-3 w-24" />
          </div>
        ))}
      </div>
    </DelayedLoading>
  );
}

export function ListView({ activeOnly = false }: ListViewProps) {
  const navigation = useTasksNavigation();
  const projects = useProjects();
  const summaries = useProjectSummaries();
  const { toasts, push, dismiss } = useDetailToasts();
  const scope = activeOnly ? "active" : "all";
  const [preference, setPreference] = useState<ListPreference>(() =>
    loadListPreference(scope),
  );
  useEffect(() => {
    setPreference(loadListPreference(scope));
  }, [scope]);
  const { filters, sort } = preference;
  const updatePreference = (next: ListPreference) => {
    storeListPreference(scope, next);
    setPreference(next);
  };
  const setFilters = (next: ListFilterState) =>
    updatePreference({ filters: next, sort });
  const setSort = (next: TaskSort) => updatePreference({ filters, sort: next });
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [collapsedStatuses, setCollapsedStatuses] = useState<
    ReadonlySet<ProjectStatus>
  >(() => new Set());
  const toggleStatusCollapsed = (status: ProjectStatus) => {
    setCollapsedStatuses((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const projectIds = useMemo(
    () => (projects.data ?? []).map((project) => project.id),
    [projects.data],
  );
  const labels = useLabels(projectIds);
  const edits = useProjectEdits(projects.data, push);
  const moveTask = useMoveTaskToProject(push);

  const visibleProjects = useMemo(() => {
    if (edits.projects === undefined) return undefined;
    return edits.projects.filter(
      (project) =>
        (filters.statuses.length === 0 ||
          filters.statuses.includes(project.status)) &&
        (filters.priorities.length === 0 ||
          filters.priorities.includes(project.priority)) &&
        (!activeOnly || (summaries.get(project.id)?.activeAgentCount ?? 0) > 0),
    );
  }, [edits.projects, filters, activeOnly, summaries]);
  const groups = useMemo(
    () => groupProjectsByStatus(sortItems(visibleProjects ?? [], sort)),
    [visibleProjects, sort],
  );
  const visibleProjectIds = useMemo(
    () => (visibleProjects ?? []).map((project) => project.id).sort(),
    [visibleProjects],
  );
  const projectThreads = useProjectThreadsByProject(visibleProjectIds);
  const busyThreadIds = useBusyThreadIds();
  const unarchivedThreadIds = useUnarchivedThreadIds();

  const scrollRef = useRef<HTMLDivElement>(null);
  useListScrollRestoration(
    scrollRef,
    listScrollScopeKey({ activeOnly, filters, sort }),
    {
      contentReady: (visibleProjects?.length ?? 0) > 0,
      loading: projects.isLoading && projects.data === undefined,
      revision: visibleProjects?.length ?? 0,
    },
  );

  const handleDrop = (status: ProjectStatus) => (event: React.DragEvent) => {
    event.preventDefault();
    const projectId = event.dataTransfer.getData(PROJECT_DRAG_TYPE);
    const dragged = visibleProjects?.find((entry) => entry.id === projectId);
    if (!dragged || dragged.status === status) return;
    const column = sortItems(
      (edits.projects ?? []).filter(
        (project) => project.status === status && project.id !== projectId,
      ),
      "manual",
    );
    edits.move(dragged, status, column.at(-1), undefined);
  };

  let body: React.ReactNode;
  if (visibleProjects === undefined) {
    body =
      projects.error !== null ? (
        <EmptyState
          icon="AlertCircle"
          title="Couldn't load projects"
          description={projects.error}
        />
      ) : (
        <LoadingRows />
      );
  } else if (visibleProjects.length === 0) {
    if (hasActiveFilters(filters)) {
      body = (
        <EmptyState
          icon="Search"
          title="No projects match these filters"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              Clear filters
            </Button>
          }
        />
      );
    } else if (activeOnly) {
      body = (
        <EmptyState
          icon="Zap"
          title="No agents working right now"
          description="Start a thread on a task and its project will show up here while the agent runs."
        />
      );
    } else {
      body = (
        <EmptyState
          icon="ListTodo"
          title="No projects yet"
          description="Create a project to start tracking tasks."
          action={
            <Button size="sm" onClick={() => setNewProjectOpen(true)}>
              <Icon name="Plus" className="size-3.5" />
              New project
            </Button>
          }
        />
      );
    }
  } else {
    body = groups.map((group) => {
      const collapsed = collapsedStatuses.has(group.status);
      return (
        <section
          key={group.status}
          data-status-section={group.status}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop(group.status)}
        >
          <button
            type="button"
            data-status-group-header={group.status}
            aria-expanded={!collapsed}
            onClick={() => toggleStatusCollapsed(group.status)}
            className={`sticky top-0 z-20 isolate flex w-full cursor-pointer items-center gap-2 bg-background px-3.5 pb-1.5 pt-4 text-left text-xs font-normal ${
              group.status === "in_progress"
                ? "text-blue-600 dark:text-blue-400"
                : "text-muted-foreground"
            }`}
          >
            {STATUS_LABELS[group.status]}
          </button>
          {collapsed
            ? null
            : group.projects.map((project, index) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  projects={projects.data}
                  summary={summaries.get(project.id)}
                  labels={labels.data}
                  threads={projectThreads.data?.get(project.id) ?? NO_THREADS}
                  threadsError={projectThreads.error}
                  busyThreadIds={busyThreadIds}
                  unarchivedThreadIds={unarchivedThreadIds}
                  onEdit={edits.edit}
                  onComplete={() => edits.complete(project)}
                  onDelete={() => edits.remove(project)}
                  onOpen={() =>
                    navigation.go({ kind: "project", projectId: project.id })
                  }
                  onMoveTaskHere={(taskId) => moveTask(taskId, project.id)}
                  onError={push}
                  isLastInSection={index === group.projects.length - 1}
                />
              ))}
        </section>
      );
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ListFilterBar
        filters={filters}
        onChange={setFilters}
        sort={sort}
        onSortChange={setSort}
      />
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto @container"
      >
        {body}
      </div>
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
      />
      <DetailToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
