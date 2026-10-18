import { useEffect, useState } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import {
  attachmentDownloadUrl,
  isMarkdownAttachment,
} from "../../shared/attachments.js";
import type { Attachment } from "../../shared/contract.js";
import { errorMessage } from "../../shared/errors.js";
import { formatFileSize } from "../activity/time.js";
import { ConfirmDialog } from "../../components/confirm-dialog.js";
import { Icon } from "@/components/ui/icon";

let tokenPromise: Promise<string> | null = null;

function pluginToken(): Promise<string> {
  tokenPromise ??= (async () => {
    const response = await fetch("/api/v1/plugins/tomato/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const json: unknown = await response.json().catch(() => null);
    const token =
      json && typeof json === "object" && "token" in json
        ? (json as { token: unknown }).token
        : undefined;
    if (!response.ok || typeof token !== "string") {
      throw new Error(`failed to fetch plugin token (HTTP ${response.status})`);
    }
    return token;
  })();
  tokenPromise.catch(() => {
    tokenPromise = null;
  });
  return tokenPromise;
}

export type AttachmentOwnerRef =
  | { projectId: string }
  | { taskId: string }
  | { commentId: string };

export async function uploadAttachment(
  file: File,
  owner: AttachmentOwnerRef,
): Promise<{ attachmentId: string; url: string }> {
  const token = await pluginToken();
  const query = new URLSearchParams({
    ...owner,
    fileName: file.name || "attachment",
    mime: file.type || "application/octet-stream",
  });
  const response = await fetch(
    `/api/v1/plugins/tomato/http/attachments/upload?${query.toString()}`,
    {
      method: "POST",
      headers: { "x-bb-plugin-token": token },
      body: file,
    },
  );
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      json && typeof json === "object" && "error" in json
        ? String((json as { error: unknown }).error)
        : `upload failed (HTTP ${response.status})`;
    throw new Error(message);
  }
  const result = json as { attachmentId: string; url: string };
  return { attachmentId: result.attachmentId, url: result.url };
}

function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);
}

export function canPreviewAttachment(attachment: Attachment): boolean {
  return attachment.isImage || isMarkdownAttachment(attachment);
}

export function AttachmentPreview({
  attachment,
  onClose,
}: {
  attachment: Attachment;
  onClose: () => void;
}) {
  return attachment.isImage ? (
    <Lightbox attachment={attachment} onClose={onClose} />
  ) : (
    <MarkdownViewer
      key={attachment.id}
      attachment={attachment}
      onClose={onClose}
    />
  );
}

type MarkdownSource =
  | { kind: "loading" }
  | { kind: "ready"; content: string }
  | { kind: "error"; message: string };

function MarkdownViewer({
  attachment,
  onClose,
}: {
  attachment: Attachment;
  onClose: () => void;
}) {
  useEscapeToClose(onClose);
  const [source, setSource] = useState<MarkdownSource>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(attachmentDownloadUrl(attachment.id), {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`failed to load file (HTTP ${response.status})`);
        }
        const content = await response.text();
        if (!controller.signal.aborted) setSource({ kind: "ready", content });
      } catch (error) {
        if (controller.signal.aborted) return;
        setSource({ kind: "error", message: errorMessage(error) });
      }
    })();
    return () => controller.abort();
  }, [attachment.id]);

  return (
    <div
      role="dialog"
      aria-label={attachment.fileName}
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
      style={{ background: "color-mix(in oklab, var(--ink) 60%, transparent)" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-md"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-secondary text-muted-foreground">
            <Icon name="File" className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {attachment.fileName}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatFileSize(attachment.sizeBytes)}
          </span>
          <a
            href={attachmentDownloadUrl(attachment.id)}
            download={attachment.fileName}
            aria-label={`Download ${attachment.fileName}`}
            title="Download"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
          >
            <Icon name="Download" className="size-4" />
          </a>
          <button
            type="button"
            aria-label="Close"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
            onClick={onClose}
          >
            <Icon name="X" className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {source.kind === "ready" ? (
            <Markdown content={source.content} />
          ) : source.kind === "error" ? (
            <p role="alert" className="text-sm text-destructive">
              {source.message}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Lightbox({
  attachment,
  onClose,
}: {
  attachment: Attachment;
  onClose: () => void;
}) {
  useEscapeToClose(onClose);
  return (
    <div
      role="dialog"
      aria-label={attachment.fileName}
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
      style={{ background: "color-mix(in oklab, var(--ink) 60%, transparent)" }}
      onClick={onClose}
    >
      <img
        src={attachmentDownloadUrl(attachment.id)}
        alt={attachment.fileName}
        className="max-h-full max-w-full rounded-md shadow-md"
        onClick={(event) => event.stopPropagation()}
      />
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md bg-popover/90 px-3 py-1.5 text-xs text-popover-foreground shadow-md">
        <span className="max-w-72 truncate">{attachment.fileName}</span>
        <span className="text-muted-foreground">
          {formatFileSize(attachment.sizeBytes)}
        </span>
      </div>
      <button
        type="button"
        aria-label="Close"
        className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-md bg-popover/90 text-popover-foreground shadow-md hover:bg-popover"
        onClick={onClose}
      >
        <Icon name="X" className="size-4" />
      </button>
    </div>
  );
}

function RemovalSpinner() {
  return (
    <span
      role="status"
      aria-label="Removing"
      className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export function AttachmentsGrid({
  attachments,
  onRemove,
  onError,
}: {
  attachments: Attachment[];
  onRemove: (attachment: Attachment) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [confirm, setConfirm] = useState<Attachment | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  const requestRemove = (attachment: Attachment) => setConfirm(attachment);

  const performRemove = async (attachment: Attachment) => {
    setConfirm(null);
    setPreview((current) => (current?.id === attachment.id ? null : current));
    setPending((current) => new Set(current).add(attachment.id));
    try {
      await onRemove(attachment);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(attachment.id);
        return next;
      });
    }
  };

  if (attachments.length === 0) return null;

  const files = attachments.filter((attachment) => !attachment.isImage);
  const images = attachments.filter((attachment) => attachment.isImage);

  const removeButton = (attachment: Attachment, variant: "image" | "file") => {
    const busy = pending.has(attachment.id);
    const base =
      variant === "image"
        ? "absolute right-1 top-1 z-10 rounded-full bg-black/55 p-0.5 text-white transition-colors hover:bg-black/70 disabled:opacity-70"
        : "shrink-0 rounded p-0.5 text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-70";
    return (
      <button
        type="button"
        aria-label={`Remove ${attachment.fileName}`}
        disabled={busy}
        className={base}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!busy) requestRemove(attachment);
        }}
      >
        {busy ? <RemovalSpinner /> : <Icon name="X" className="size-3" />}
      </button>
    );
  };

  const fileCardLabel = (attachment: Attachment) => (
    <>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-secondary text-muted-foreground">
        <Icon name="File" className="size-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block max-w-48 truncate">{attachment.fileName}</span>
        <span className="block text-2xs text-muted-foreground">
          {formatFileSize(attachment.sizeBytes)}
        </span>
      </span>
    </>
  );

  const fileCard = (attachment: Attachment) => (
    <div
      key={attachment.id}
      className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm shadow-2xs"
    >
      {canPreviewAttachment(attachment) ? (
        <>
          <button
            type="button"
            aria-label={`Open ${attachment.fileName}`}
            className="flex min-w-0 items-center gap-2 rounded-sm text-left hover:bg-state-hover"
            onClick={() => setPreview(attachment)}
          >
            {fileCardLabel(attachment)}
          </button>
          <a
            href={attachmentDownloadUrl(attachment.id)}
            download={attachment.fileName}
            aria-label={`Download ${attachment.fileName}`}
            title="Download"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-state-hover hover:text-foreground"
          >
            <Icon name="Download" className="size-3" />
          </a>
        </>
      ) : (
        <a
          href={attachmentDownloadUrl(attachment.id)}
          download={attachment.fileName}
          className="flex min-w-0 items-center gap-2 rounded-sm hover:bg-state-hover"
        >
          {fileCardLabel(attachment)}
        </a>
      )}
      {removeButton(attachment, "file")}
    </div>
  );

  const imageTile = (attachment: Attachment) => (
    <div
      key={attachment.id}
      className="group relative overflow-hidden rounded-md border border-border shadow-2xs"
    >
      <button
        type="button"
        className="block"
        title={`${attachment.fileName} · ${formatFileSize(attachment.sizeBytes)}`}
        onClick={() => setPreview(attachment)}
      >
        <img
          src={attachmentDownloadUrl(attachment.id)}
          alt={attachment.fileName}
          className="block h-24 w-36 object-cover transition-opacity group-hover:opacity-90"
        />
        <span
          className="absolute inset-x-0 bottom-0 truncate px-1.5 py-0.5 text-left text-2xs opacity-0 transition-opacity group-hover:opacity-100"
          style={{
            background: "color-mix(in oklab, var(--ink) 55%, transparent)",
            color: "var(--canvas)",
          }}
        >
          {attachment.fileName}
        </span>
      </button>
      {removeButton(attachment, "image")}
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {files.length > 0 ? (
        <div className="flex flex-wrap items-start gap-2">
          {files.map(fileCard)}
        </div>
      ) : null}
      {images.length > 0 ? (
        <div className="flex flex-wrap items-start gap-2">
          {images.map(imageTile)}
        </div>
      ) : null}
      {preview ? (
        <AttachmentPreview
          attachment={preview}
          onClose={() => setPreview(null)}
        />
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title="Remove attachment?"
        description={
          confirm
            ? `"${confirm.fileName}" will be permanently removed. Any references in the task description will be removed too. This cannot be undone.`
            : ""
        }
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirm) void performRemove(confirm);
        }}
      />
    </div>
  );
}
