import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Markdown, useSdk } from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Popover, PopoverAnchor, PopoverContent } from "@bb/shared-ui/popover";
import { Textarea } from "@bb/shared-ui/textarea";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePaneLinkedWork, type PaneLinkedWork } from "./linked-work";

export const HOVER_OPEN_DELAY_MS = 300;
export const HOVER_CLOSE_DELAY_MS = 250;

const drafts = new Map<string, string>();

export function paneLabel(title: string, work: PaneLinkedWork | null): string {
  return work === null
    ? title
    : `${title} — ${work.kind === "task" ? "Task" : "Project"} ${work.label}`;
}

export function AttentionDot() {
  return (
    <span className="absolute -right-1 -top-1 size-2 rounded-full bg-attention" />
  );
}

export function LinkedWorkLabel({
  work,
  className,
}: {
  work: PaneLinkedWork;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("flex min-w-0 items-center gap-1.5", className)}
    >
      {work.kind === "project" && work.color !== null ? (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: work.color }}
        />
      ) : null}
      <span
        className={cn(
          "min-w-0 truncate",
          work.kind === "task" && "text-timeline-accent",
        )}
      >
        {work.label}
      </span>
    </span>
  );
}

type LatestMessage =
  | { state: "loading" }
  | { state: "loaded"; text: string | null }
  | { state: "failed" };

function useLatestMessage(
  threadId: string | null,
  enabled: boolean,
  version: number,
): LatestMessage {
  const sdk = useSdk();
  const [latest, setLatest] = useState<LatestMessage>({ state: "loading" });
  useEffect(() => {
    if (!enabled || threadId === null) return;
    const controller = new AbortController();
    sdk.threads
      .output({ threadId, signal: controller.signal })
      .then(({ output }) => setLatest({ state: "loaded", text: output }))
      .catch(() => {
        if (!controller.signal.aborted) setLatest({ state: "failed" });
      });
    return () => controller.abort();
  }, [enabled, sdk, threadId, version]);
  return latest;
}

function LatestMessageBody({ latest }: { latest: LatestMessage }) {
  if (latest.state === "loading") {
    return <p className="text-xs text-muted-foreground">Loading…</p>;
  }
  if (latest.state === "failed") {
    return (
      <p className="text-xs text-muted-foreground">
        Couldn't load the latest message.
      </p>
    );
  }
  if (latest.text === null || latest.text.trim() === "") {
    return <p className="text-xs text-muted-foreground">No messages yet.</p>;
  }
  return <Markdown content={latest.text} className="text-xs leading-5" />;
}

type SendState = "idle" | "sending" | "sent" | "failed";

function QuickReply({
  threadId,
  onFocusChange,
}: {
  threadId: string;
  onFocusChange: (focused: boolean) => void;
}) {
  const sdk = useSdk();
  const [draft, setDraft] = useState(() => drafts.get(threadId) ?? "");
  const [sendState, setSendState] = useState<SendState>("idle");
  const updateDraft = (next: string) => {
    setDraft(next);
    if (next === "") drafts.delete(threadId);
    else drafts.set(threadId, next);
    if (sendState !== "sending") setSendState("idle");
  };
  const send = async () => {
    const text = draft.trim();
    if (text === "" || sendState === "sending") return;
    setSendState("sending");
    try {
      await sdk.threads.send({
        threadId,
        input: [{ type: "text", text, mentions: [] }],
        mode: "queue-if-active",
      });
      updateDraft("");
      setSendState("sent");
    } catch {
      setSendState("failed");
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    void send();
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        aria-label="Reply"
        placeholder="Reply…"
        rows={2}
        value={draft}
        onChange={(event) => updateDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        className="max-h-32 min-h-14 resize-none text-xs"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {sendState === "sent"
            ? "Sent"
            : sendState === "failed"
              ? "Couldn't send. Try again."
              : "Enter to send, Shift+Enter for a new line"}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={draft.trim() === "" || sendState === "sending"}
          onClick={() => void send()}
        >
          Send
        </Button>
      </div>
    </div>
  );
}

export interface MinimizedChipProps {
  pane: HTMLElement;
  threadId: string | null;
  title: string;
  needsInput: boolean;
  finishedUnread: boolean;
  updatedAt: number;
  onRestore: () => void;
}

export function MinimizedChip({
  pane,
  threadId,
  title,
  needsInput,
  finishedUnread,
  updatedAt,
  onRestore,
}: MinimizedChipProps) {
  const work = usePaneLinkedWork(pane);
  const label = paneLabel(title, work);
  const [open, setOpen] = useState(false);
  const replyFocused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useLatestMessage(threadId, open, updatedAt);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const schedule = (next: boolean, delay: number) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!next && replyFocused.current) return;
      setOpen(next);
    }, delay);
  };
  const hoverIn = () => schedule(true, open ? 0 : HOVER_OPEN_DELAY_MS);
  const hoverOut = () => schedule(false, HOVER_CLOSE_DELAY_MS);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) replyFocused.current = false;
        setOpen(next);
      }}
    >
      <PopoverAnchor asChild>
        <button
          type="button"
          aria-label={`Restore ${label}${finishedUnread ? ", new reply" : ""}`}
          aria-expanded={open}
          title={open ? undefined : label}
          onClick={onRestore}
          onPointerEnter={hoverIn}
          onPointerLeave={hoverOut}
          className="relative z-50 flex h-6 min-w-12 max-w-80 shrink cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground [-webkit-app-region:no-drag] [app-region:no-drag] hover:bg-state-hover hover:text-foreground"
        >
          <span className="relative flex shrink-0">
            <Icon
              name="MessageSquare"
              className={cn(
                "size-3.5",
                finishedUnread && "text-timeline-accent",
              )}
            />
            {needsInput ? <AttentionDot /> : null}
          </span>
          <span className="min-w-0 truncate">{title}</span>
          {work === null ? null : (
            <LinkedWorkLabel
              work={work}
              className="max-w-[50%] shrink-0 border-l border-border pl-1.5"
            />
          )}
        </button>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
        className="flex w-96 flex-col gap-2 p-3"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {title}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={() => {
              setOpen(false);
              onRestore();
            }}
          >
            Open
          </Button>
        </div>
        {work === null ? null : (
          <LinkedWorkLabel work={work} className="-mt-1 text-xs" />
        )}
        {needsInput ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2 shrink-0 rounded-full bg-attention" />
            Waiting for your approval or answer. Open the thread to respond.
          </p>
        ) : null}
        <div className="max-h-64 overflow-y-auto rounded-md bg-muted/40 p-2">
          <LatestMessageBody latest={latest} />
        </div>
        {threadId === null ? null : (
          <QuickReply
            threadId={threadId}
            onFocusChange={(focused) => {
              replyFocused.current = focused;
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
