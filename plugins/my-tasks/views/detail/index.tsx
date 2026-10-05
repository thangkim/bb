import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import SmilePlusIcon from "@hugeicons/core-free-icons/SmilePlusIcon";
import type { Task } from "../../shared/contract.js";
import { errorMessage } from "../../shared/errors.js";
import type { DelegationRpcContract } from "../../delegate/contract.js";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import {
  useMentionItems,
  useTasksQuery,
  useTasksRpc,
} from "../../shell/data.js";
import { TasksEditor } from "../../editor/tasks-editor.js";
import { TaskActivity } from "../activity/task-activity.js";
import { AttachmentsGrid, uploadAttachment } from "./attachments.js";
import {
  createDescriptionSaver,
  type DescriptionSaver,
} from "./description-save.js";
import {
  InlineProperties,
  PropertiesRail,
  type TaskPropertyUpdate,
} from "./rail.js";
import { ThreadsSection } from "./threads.js";
import { AttachThreadPicker, NewThreadMenu } from "../tasks/thread-actions.js";
import { DetailToasts, useDetailToasts } from "./toast.js";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";

interface DetailViewProps {
  taskKey: string;
}

const DESCRIPTION_SAVE_DELAY_MS = 800;
const ACTIVE_PULL_REQUEST_REFRESH_MS = 60_000;

export function EditableTitle({
  id,
  title,
  label,
  onSave,
}: {
  id: string;
  title: string;
  label: string;
  onSave: (title: string) => void;
}) {
  return (
    <h1
      key={`${id}:${title}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      className="mb-2.5 mt-1 text-2xl font-semibold leading-tight outline-none"
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        const next = event.currentTarget.textContent?.trim() ?? "";
        if (!next) {
          event.currentTarget.textContent = title;
          return;
        }
        if (next !== title) onSave(next);
      }}
    >
      {title}
    </h1>
  );
}

function DetailSkeleton() {
  return (
    <DelayedLoading>
      <div className="mx-auto w-full max-w-3xl px-8 py-12">
        <Skeleton className="mb-4 h-7 w-2/3" />
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="mb-2 h-4 w-5/6" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </DelayedLoading>
  );
}

function TaskDetail({ task }: { task: Task }) {
  const rpc = useTasksRpc();
  const delegationRpc = useRpc<DelegationRpcContract>();
  const { toasts, push, dismiss } = useDetailToasts();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<{ taskId: string; markdown: string }>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const pushRef = useRef(push);
  pushRef.current = push;
  const saverRef = useRef<DescriptionSaver | null>(null);
  saverRef.current ??= createDescriptionSaver({
    save: async (taskId, markdown) => {
      const result = await rpcRef.current.call("updateTask", {
        taskId,
        description: markdown,
      });
      return result.ok
        ? { ok: true }
        : { ok: false, errorMessage: result.error.message };
    },
    onError: (message) => pushRef.current(message),
    delayMs: DESCRIPTION_SAVE_DELAY_MS,
  });

  const projects = useTasksQuery(
    async (query) => (await query.call("listProjects", {})).projects,
    ["projects:changed"],
  );
  const project = projects.data?.find((entry) => entry.id === task.projectId);

  const labels = useTasksQuery(
    async (query) =>
      (await query.call("listLabels", { projectId: task.projectId })).labels,
    ["projects:changed"],
    [task.projectId],
  );
  const attachments = useTasksQuery(
    async (query) =>
      (await query.call("listAttachments", { taskId: task.id })).attachments,
    ["tasks:changed"],
    [task.id],
  );
  const threads = useTasksQuery(
    async (query) =>
      (await query.call("listTaskThreads", { taskId: task.id })).taskThreads,
    ["threads:changed"],
    [task.id],
  );
  const presets = useTasksQuery(
    async (query) => (await query.call("listPresets")).presets,
    ["projects:changed"],
  );
  const pullRequests = useTasksQuery(
    async (query) => query.call("listTaskPullRequests", { taskId: task.id }),
    ["threads:changed"],
    [task.id],
  );
  const refreshPullRequests = pullRequests.refresh;
  const hasActivePullRequest = (pullRequests.data?.pullRequests ?? []).some(
    (pullRequest) =>
      pullRequest.state === "open" || pullRequest.state === "draft",
  );
  useEffect(() => {
    window.addEventListener("focus", refreshPullRequests);
    return () => window.removeEventListener("focus", refreshPullRequests);
  }, [refreshPullRequests]);
  useEffect(() => {
    if (!hasActivePullRequest) return;
    const timer = window.setInterval(
      refreshPullRequests,
      ACTIVE_PULL_REQUEST_REFRESH_MS,
    );
    return () => window.clearInterval(timer);
  }, [hasActivePullRequest, refreshPullRequests]);

  const updateTask = async (
    input: TaskPropertyUpdate & { title?: string; description?: string },
  ) => {
    try {
      const result = await rpc.call("updateTask", {
        taskId: task.id,
        ...input,
      });
      if (!result.ok) push(result.error.message);
    } catch (error) {
      push(errorMessage(error));
    }
  };

  const onDescriptionChange = (markdown: string) => {
    setDraft({ taskId: task.id, markdown });
    saverRef.current?.onChange(task.id, markdown);
  };

  useEffect(() => {
    return () => saverRef.current?.flush(task.id);
  }, [task.id]);

  const uploadForTask = async (file: File) => {
    const result = await uploadAttachment(file, { taskId: task.id });
    attachments.refresh();
    return result;
  };

  const onPickFiles = async (files: FileList | null) => {
    for (const file of files ?? []) {
      try {
        await uploadAttachment(file, { taskId: task.id });
      } catch (error) {
        push(errorMessage(error));
      }
    }
    attachments.refresh();
  };

  const mentionItems = useMentionItems();
  const navigate = useBbNavigate();

  const descriptionValue =
    draft && draft.taskId === task.id ? draft.markdown : task.description;

  return (
    <div className="@container flex min-h-full flex-col bg-surface-recessed-solid p-3">
      <div className="flex flex-1 items-stretch rounded-lg border border-border bg-card shadow-2xs">
        <div className="mx-auto w-full min-w-0 max-w-[55rem] flex-1 px-7 pb-16 pt-8 @3xl:px-13 @3xl:pt-11">
          <EditableTitle
            id={task.id}
            title={task.title}
            label="Task title"
            onSave={(title) => void updateTask({ title })}
          />

          <InlineProperties
            task={task}
            labels={labels.data}
            presets={presets.data}
            onUpdate={(update) => void updateTask(update)}
            onError={(message) => push(message)}
            className="mb-4 @[45rem]:hidden"
          />

          <TasksEditor
            value={descriptionValue}
            onChange={onDescriptionChange}
            variant="doc"
            className="min-h-24"
            placeholder="Add a description… rich text: headings, lists, code, checkboxes, @mentions"
            onUploadImage={uploadForTask}
            mentionItems={mentionItems}
            onOpenThread={(threadId) => navigate.toThread(threadId)}
          />

          <div className="mb-1 mt-3 flex items-center gap-1">
            <button
              type="button"
              title="Reactions coming soon"
              aria-label="Add reaction"
              disabled
              className="flex size-6.5 items-center justify-center rounded-md text-muted-foreground opacity-50"
            >
              <HugeiconsIcon icon={SmilePlusIcon} className="size-4" />
            </button>
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

          <div className="mt-6">
            {(threads.data ?? []).length > 0 ? (
              <ThreadsSection
                threads={threads.data ?? []}
                pullRequests={pullRequests.data?.pullRequests}
                unavailableThreadIds={
                  pullRequests.data?.unavailableThreadIds ?? []
                }
                onDetach={async (thread) => {
                  await delegationRpc.call("taskThreadsDetach", {
                    taskId: task.id,
                    threadId: thread.threadId,
                  });
                  threads.refresh();
                  pullRequests.refresh();
                }}
                onError={(message) => push(message)}
              />
            ) : null}
            <div className="flex items-center gap-1 pt-1">
              <NewThreadMenu
                target={{ kind: "task", taskId: task.id }}
                presets={presets.data}
                onError={push}
                unlinkedProjectId={
                  project?.linkedBbProjectId === null ? project.id : null
                }
              />
              <AttachThreadPicker
                target={{ kind: "task", taskId: task.id }}
                attachedThreadIds={(threads.data ?? []).map(
                  (thread) => thread.threadId,
                )}
                onError={push}
              />
            </div>
          </div>

          <div className="mt-1">
            <TaskActivity taskId={task.id} />
          </div>
        </div>

        <PropertiesRail
          task={task}
          project={project}
          labels={labels.data}
          threads={threads.data ?? []}
          presets={presets.data}
          onUpdate={(update) => void updateTask(update)}
          onError={(message) => push(message)}
          className="hidden @[45rem]:block"
        />
      </div>
      <DetailToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

export function DetailView({ taskKey }: DetailViewProps) {
  const query = useTasksQuery(
    async (rpc) => (await rpc.call("getTaskByKey", { taskKey })).task,
    ["tasks:changed"],
    [taskKey],
  );

  if (query.data === undefined) {
    return query.error ? (
      <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
        {query.error}
      </div>
    ) : (
      <DetailSkeleton />
    );
  }
  if (query.data === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <Icon name="FileQuestion" className="size-5" />
        Task {taskKey} was not found.
      </div>
    );
  }
  return <TaskDetail task={query.data} />;
}
