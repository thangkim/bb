import { useEffect, useMemo, useRef, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type {
  Preset,
  Project,
  ProjectStatus,
  Priority,
} from "../../shared/contract.js";
import { errorMessage } from "../../shared/errors.js";
import {
  useMentionItems,
  usePresets,
  useProjects,
  useTasksQuery,
  useTasksRpc,
} from "../../shell/data.js";
import { useTasksNavigation } from "../../shell/routes.js";
import { TasksEditor } from "../../editor/tasks-editor.js";
import { ProgressBar } from "../../components/progress-bar.js";
import { EditableTitle } from "../detail/index.js";
import { AttachmentsGrid, uploadAttachment } from "../detail/attachments.js";
import {
  createDescriptionSaver,
  type DescriptionSaver,
} from "../detail/description-save.js";
import {
  CHIP_CLASS,
  DispatchTargetMenu,
  DueDateMenu,
  PriorityMenu,
  ProjectStatusMenu,
  RAIL_ROW_CLASS,
} from "../detail/rail.js";
import { DetailToasts, useDetailToasts } from "../detail/toast.js";
import {
  useProjectSummaries,
  useProjectTasks,
  useTaskListMeta,
} from "../list/data.js";
import { TaskChecklist, ThreadRow } from "../tasks/checklist.js";
import { ProjectThreadList } from "../tasks/project-threads.js";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";

const DESCRIPTION_SAVE_DELAY_MS = 800;

interface ProjectUpdate {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  priority?: Priority;
  dueDate?: string | null;
}

function ProjectProperties({
  project,
  triggerClassName,
  onUpdate,
}: {
  project: Project;
  triggerClassName: string;
  onUpdate: (update: ProjectUpdate) => void;
}) {
  return (
    <>
      <ProjectStatusMenu
        status={project.status}
        onChange={(status) => onUpdate({ status })}
        triggerClassName={triggerClassName}
      />
      <PriorityMenu
        priority={project.priority}
        onChange={(priority) => onUpdate({ priority })}
        triggerClassName={triggerClassName}
      />
      <DueDateMenu
        dueDate={project.dueDate}
        onChange={(dueDate) => onUpdate({ dueDate })}
        triggerClassName={triggerClassName}
      />
    </>
  );
}

function ProjectThreads({
  projectId,
  linked,
  presets,
  onError,
}: {
  projectId: string;
  linked: boolean;
  presets: Preset[] | undefined;
  onError: (message: string) => void;
}) {
  const tasks = useProjectTasks(projectId);
  const meta = useTaskListMeta(tasks.data);
  const rows = useMemo(
    () =>
      (tasks.data ?? []).flatMap((task) =>
        (meta.data?.get(task.id)?.threads ?? []).map((thread) => ({
          task,
          thread,
        })),
      ),
    [tasks.data, meta.data],
  );
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-xs font-semibold text-muted-foreground">
        Threads
      </h2>
      <ProjectThreadList
        projectId={projectId}
        linked={linked}
        presets={presets}
        onError={onError}
        className={rows.length > 0 ? "mb-1" : undefined}
      />
      <div className="flex flex-col gap-0.5">
        {rows.map(({ task, thread }) => (
          <div key={thread.id} className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <ThreadRow thread={thread} />
            </div>
            <span className="max-w-[45%] shrink-0 truncate text-xs text-subtle-foreground">
              → {task.title}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProjectSkeleton() {
  return (
    <DelayedLoading>
      <div className="mx-auto w-full max-w-3xl px-8 py-12">
        <Skeleton className="mb-4 h-7 w-2/3" />
        <Skeleton className="mb-6 h-4 w-1/3" />
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="mb-2 h-4 w-5/6" />
      </div>
    </DelayedLoading>
  );
}

function ProjectDetail({
  project,
  projects,
}: {
  project: Project;
  projects: readonly Project[];
}) {
  const rpc = useTasksRpc();
  const navigate = useBbNavigate();
  const { toasts, push, dismiss } = useDetailToasts();
  const summaries = useProjectSummaries();
  const summary = summaries.get(project.id);
  const presets = usePresets();
  const mentionItems = useMentionItems();
  const labels = useTasksQuery(
    async (query) =>
      (await query.call("listLabels", { projectId: project.id })).labels,
    ["projects:changed"],
    [project.id],
  );
  const bbProjects = useTasksQuery(
    async (query) => (await query.call("listBbProjects")).bbProjects,
    ["projects:changed"],
  );
  const attachments = useTasksQuery(
    async (query) =>
      (await query.call("listAttachments", { projectId: project.id }))
        .attachments,
    ["projects:changed"],
    [project.id],
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadForProject = async (file: File) => {
    const result = await uploadAttachment(file, { projectId: project.id });
    attachments.refresh();
    return result;
  };

  const onPickFiles = async (files: FileList | null) => {
    for (const file of files ?? []) {
      try {
        await uploadAttachment(file, { projectId: project.id });
      } catch (error) {
        push(errorMessage(error));
      }
    }
    attachments.refresh();
  };

  const [draft, setDraft] = useState<{ projectId: string; markdown: string }>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const pushRef = useRef(push);
  pushRef.current = push;
  const saverRef = useRef<DescriptionSaver | null>(null);
  saverRef.current ??= createDescriptionSaver({
    save: async (projectId, markdown) => {
      try {
        await rpcRef.current.call("updateProject", {
          projectId,
          description: markdown,
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, errorMessage: errorMessage(error) };
      }
    },
    onError: (message) => pushRef.current(message),
    delayMs: DESCRIPTION_SAVE_DELAY_MS,
  });
  useEffect(() => {
    return () => saverRef.current?.flush(project.id);
  }, [project.id]);

  const updateProject = async (update: ProjectUpdate) => {
    try {
      await rpc.call("updateProject", { projectId: project.id, ...update });
    } catch (error) {
      push(errorMessage(error));
    }
  };

  const descriptionValue =
    draft && draft.projectId === project.id
      ? draft.markdown
      : project.description;
  const done = summary?.doneTaskCount ?? 0;
  const total = summary?.taskCount ?? 0;
  const working = (summary?.activeAgentCount ?? 0) > 0;

  return (
    <div className="@container flex min-h-full flex-col bg-surface-recessed-solid p-3">
      <div className="flex flex-1 items-stretch rounded-lg border border-border bg-card shadow-2xs">
        <div className="mx-auto w-full min-w-0 max-w-[55rem] flex-1 px-7 pb-16 pt-8 @3xl:px-13 @3xl:pt-11">
          <EditableTitle
            id={project.id}
            title={project.name}
            label="Project name"
            onSave={(name) => void updateProject({ name })}
          />

          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5 @[45rem]:hidden">
              <ProjectProperties
                project={project}
                triggerClassName={CHIP_CLASS}
                onUpdate={(update) => void updateProject(update)}
              />
            </div>
            <span className="flex items-center gap-2 text-xs text-subtle-foreground">
              <ProgressBar done={done} total={total} active={working} />
            </span>
          </div>

          <TasksEditor
            value={descriptionValue}
            onChange={(markdown) => {
              setDraft({ projectId: project.id, markdown });
              saverRef.current?.onChange(project.id, markdown);
            }}
            variant="doc"
            className="min-h-16"
            placeholder="Describe the project… paste or drop images"
            onUploadImage={uploadForProject}
            mentionItems={mentionItems}
            onOpenThread={(threadId) => navigate.toThread(threadId)}
          />

          <div className="mb-1 mt-3 flex items-center gap-1">
            <button
              type="button"
              title="Attach file"
              aria-label="Attach file"
              className="flex size-6.5 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="Paperclip" className="size-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                void onPickFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          <AttachmentsGrid
            attachments={attachments.data ?? []}
            onRemove={async (attachment) => {
              const result = await rpc.call("deleteAttachment", {
                attachmentId: attachment.id,
                removeDescriptionReferences: true,
              });
              if (!result.ok) throw new Error(result.error.message);
              attachments.refresh();
            }}
            onError={(message) => push(message)}
          />

          <section className="mt-6">
            <h2 className="mb-1 text-xs font-semibold text-muted-foreground">
              Tasks
            </h2>
            <TaskChecklist
              projectId={project.id}
              projects={projects}
              labels={labels.data}
              presets={presets.data}
              onError={push}
            />
          </section>

          <ProjectThreads
            projectId={project.id}
            linked={project.linkedBbProjectId !== null}
            presets={presets.data}
            onError={push}
          />
        </div>

        <aside className="hidden w-56 shrink-0 py-10 pl-2 pr-6 @[45rem]:block">
          <h2 className="mb-1.5 text-xs font-semibold text-muted-foreground">
            Properties
          </h2>
          <ProjectProperties
            project={project}
            triggerClassName={RAIL_ROW_CLASS}
            onUpdate={(update) => void updateProject(update)}
          />
          <div className="mb-1 mt-3 text-2xs font-semibold text-muted-foreground">
            Dispatch target
          </div>
          <DispatchTargetMenu
            project={project}
            bbProjects={bbProjects.data ?? []}
            onError={push}
            triggerClassName={RAIL_ROW_CLASS}
          />
        </aside>
      </div>
      <DetailToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

export function ProjectDetailView({ projectId }: { projectId: string }) {
  const projects = useProjects();
  const navigation = useTasksNavigation();
  const project = projects.data?.find((entry) => entry.id === projectId);

  if (projects.data === undefined) {
    return projects.error ? (
      <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
        {projects.error}
      </div>
    ) : (
      <ProjectSkeleton />
    );
  }
  if (project === undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <Icon name="FileQuestion" className="size-5" />
        This project was not found.
        <button
          type="button"
          className="text-xs underline"
          onClick={() => navigation.go({ kind: "all" })}
        >
          Back to all projects
        </button>
      </div>
    );
  }
  return <ProjectDetail project={project} projects={projects.data} />;
}
