import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Markdown, useSdk } from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@bb/shared-ui/popover";
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

interface ContextUsage {
  usedTokens: number;
  modelContextWindow: number;
  estimated: boolean;
  cost?: { amount: number; currency: string };
}

type ThreadPreview =
  | { state: "loading" }
  | { state: "failed" }
  | {
      state: "loaded";
      assistant: string | null;
      user: string | null;
      usage: ContextUsage | null;
    };

function useThreadPreview(
  threadId: string | null,
  enabled: boolean,
  version: number,
): ThreadPreview {
  const sdk = useSdk();
  const [preview, setPreview] = useState<ThreadPreview>({ state: "loading" });
  useEffect(() => {
    if (!enabled || threadId === null) return;
    const controller = new AbortController();
    const { signal } = controller;
    void Promise.allSettled([
      (async () => sdk.threads.output({ threadId, signal }))(),
      (async () =>
        sdk.threads.conversationOutline({ threadId, role: "user", signal }))(),
      (async () => sdk.threads.context({ threadId, signal }))(),
    ]).then(([output, outline, context]) => {
      if (signal.aborted) return;
      if (output.status === "rejected") {
        setPreview({ state: "failed" });
        return;
      }
      setPreview({
        state: "loaded",
        assistant: output.value.output,
        user:
          outline.status === "fulfilled"
            ? (outline.value.items.at(-1)?.preview ?? null)
            : null,
        usage: context.status === "fulfilled" ? context.value.usage : null,
      });
    });
    return () => controller.abort();
  }, [enabled, sdk, threadId, version]);
  return preview;
}

function PreviewBody({ preview }: { preview: ThreadPreview }) {
  if (preview.state === "loading") {
    return <p className="text-xs text-muted-foreground">Loading…</p>;
  }
  if (preview.state === "failed") {
    return (
      <p className="text-xs text-muted-foreground">
        Couldn't load the latest messages.
      </p>
    );
  }
  const user = preview.user?.trim() ?? "";
  const assistant = preview.assistant?.trim() ?? "";
  if (user === "" && assistant === "") {
    return <p className="text-xs text-muted-foreground">No messages yet.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {user === "" ? null : (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-muted-foreground">You</span>
          <p className="line-clamp-4 whitespace-pre-wrap break-words text-xs leading-5">
            {user}
          </p>
        </div>
      )}
      {assistant === "" ? null : (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-muted-foreground">
            Assistant
          </span>
          <Markdown content={assistant} className="text-xs leading-5" />
        </div>
      )}
    </div>
  );
}

const COMPACT_TOKEN_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 0,
});

function formatTokens(value: number): string {
  return COMPACT_TOKEN_FORMAT.format(
    Math.max(0, Math.round(value)),
  ).toLowerCase();
}

function usagePercent(usage: ContextUsage): number {
  if (usage.modelContextWindow <= 0) return 0;
  const ratio = usage.usedTokens / usage.modelContextWindow;
  return Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
}

function toneClassFor(percent: number): string {
  return percent >= 90
    ? "text-destructive"
    : percent >= 75
      ? "text-warning-text"
      : "text-muted-foreground";
}

function formatCost(cost: { amount: number; currency: string }): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cost.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: cost.amount < 1 ? 4 : 2,
    }).format(cost.amount);
  } catch {
    return `${cost.amount} ${cost.currency}`;
  }
}

const RING_RADIUS = 6.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_CLOSE_DELAY_MS = 60;

function ContextWindowRing({ usage }: { usage: ContextUsage }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const hoverIn = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    setOpen(true);
  };
  const hoverOut = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), RING_CLOSE_DELAY_MS);
  };
  const percent = usagePercent(usage);
  const toneClass = toneClassFor(percent);
  const title = usage.estimated ? "Estimated context" : "Context window";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Context window ${percent}% used`}
          onPointerEnter={hoverIn}
          onPointerLeave={hoverOut}
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg
            viewBox="0 0 16 16"
            className={cn("size-4", toneClass)}
            aria-hidden="true"
          >
            <circle
              cx="8"
              cy="8"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="3"
              className="stroke-border-hairline"
            />
            <circle
              cx="8"
              cy="8"
              r={RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - percent / 100)}
              transform="rotate(-90 8 8)"
            />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
        className="w-56 p-2"
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{title}</span>
            <span className={cn("font-medium tabular-nums", toneClass)}>
              {percent}% used
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Context window used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="relative h-1.5 w-full overflow-hidden rounded-full bg-border"
          >
            <div
              className={cn("h-full rounded-full bg-current", toneClass)}
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums text-muted-foreground">
            <span>
              {formatTokens(usage.usedTokens)} /{" "}
              {formatTokens(usage.modelContextWindow)} tokens
            </span>
            <span>{100 - percent}% left</span>
          </div>
          {usage.cost === undefined ? null : (
            <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums text-muted-foreground">
              <span>Session cost</span>
              <span>{formatCost(usage.cost)}</span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type SendState = "idle" | "sending" | "sent" | "failed";

function QuickReply({
  threadId,
  usage,
  onFocusChange,
}: {
  threadId: string;
  usage: ContextUsage | null;
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
        placeholder="Reply… Enter to send, Shift+Enter for a new line"
        rows={2}
        value={draft}
        onChange={(event) => updateDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        className="max-h-32 min-h-14 resize-none text-xs"
      />
      <div className="flex items-center justify-between gap-2">
        {sendState === "sent" || sendState === "failed" ? (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {sendState === "sent" ? "Sent" : "Couldn't send. Try again."}
          </span>
        ) : (
          <span />
        )}
        <div className="flex shrink-0 items-center gap-1">
          {usage === null ? null : <ContextWindowRing usage={usage} />}
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
  const preview = useThreadPreview(threadId, open, updatedAt);

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
        className="flex max-h-[min(600px,var(--radix-popover-content-available-height))] w-96 flex-col gap-2 p-3"
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
        <div className="min-h-0 overflow-y-auto rounded-md bg-muted/40 p-2">
          <PreviewBody preview={preview} />
        </div>
        {threadId === null ? null : (
          <QuickReply
            threadId={threadId}
            usage={preview.state === "loaded" ? preview.usage : null}
            onFocusChange={(focused) => {
              replyFocused.current = focused;
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
