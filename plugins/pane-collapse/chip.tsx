import { useEffect, useRef, useState, type FocusEvent } from "react";
import { ThreadChat } from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@bb/shared-ui/popover";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePaneLinkedWork, type PaneLinkedWork } from "./linked-work";

export const HOVER_OPEN_DELAY_MS = 300;
export const HOVER_CLOSE_DELAY_MS = 250;

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

export const UPRIGHT_VERTICAL_TEXT_CLASS =
  "[writing-mode:vertical-rl] [text-orientation:upright]";

export function StripLinkedWork({
  work,
  vertical,
}: {
  work: PaneLinkedWork;
  vertical: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex min-h-0 min-w-0 items-center gap-1.5 text-xs",
        vertical && "mt-2 flex-col",
      )}
    >
      {work.kind === "project" && work.color !== null ? (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: work.color }}
        />
      ) : null}
      <span
        className={cn(
          "min-h-0 min-w-0 truncate",
          work.kind === "task" && "text-timeline-accent",
          vertical && UPRIGHT_VERTICAL_TEXT_CLASS,
        )}
      >
        {work.label}
      </span>
    </span>
  );
}

export interface MinimizedChipProps {
  pane: HTMLElement;
  threadId: string | null;
  title: string;
  needsInput: boolean;
  finishedUnread: boolean;
  vertical: boolean;
  onRestore: () => void;
}

export function MinimizedChip({
  pane,
  threadId,
  title,
  needsInput,
  finishedUnread,
  vertical,
  onRestore,
}: MinimizedChipProps) {
  const work = usePaneLinkedWork(pane);
  const label = paneLabel(title, work);
  const [open, setOpen] = useState(false);
  const replyFocused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          className={cn(
            "flex cursor-pointer items-center text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground",
            vertical
              ? "h-full w-9 shrink-0 flex-col gap-2 overflow-hidden border-r border-border-seam bg-background py-3"
              : "relative z-50 h-6 min-w-12 max-w-80 shrink gap-1.5 rounded-md border border-border px-2 [-webkit-app-region:no-drag] [app-region:no-drag]",
          )}
        >
          <span className="relative flex shrink-0">
            <Icon
              name="MessageSquare"
              className={cn(
                vertical ? "size-4" : "size-3.5",
                finishedUnread && "text-timeline-accent",
              )}
            />
            {needsInput ? <AttentionDot /> : null}
          </span>
          <span
            className={cn(
              "min-w-0 truncate",
              vertical && cn("min-h-0", UPRIGHT_VERTICAL_TEXT_CLASS),
            )}
          >
            {title}
          </span>
          {work === null ? null : vertical ? (
            <StripLinkedWork work={work} vertical />
          ) : (
            <LinkedWorkLabel
              work={work}
              className="max-w-[50%] shrink-0 border-l border-border pl-1.5"
            />
          )}
        </button>
      </PopoverAnchor>
      <PopoverContent
        side={vertical ? "right" : "bottom"}
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
        className="flex h-[min(640px,var(--radix-popover-content-available-height))] w-[30rem] flex-col gap-2 p-3"
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
        {threadId === null ? null : (
          <div
            className="flex min-h-0 flex-1 flex-col"
            onFocusCapture={() => {
              replyFocused.current = true;
            }}
            onBlurCapture={(event: FocusEvent<HTMLDivElement>) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                replyFocused.current = false;
              }
            }}
          >
            <ThreadChat
              threadId={threadId}
              variant="compact"
              className="min-h-0 flex-1"
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
