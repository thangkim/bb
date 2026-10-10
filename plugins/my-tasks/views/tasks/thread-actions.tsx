import { useEffect, useState } from "react";
import {
  experimental_useSplitPanes,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { HugeiconsIcon } from "@hugeicons/react";
import BubbleChatAddIcon from "@hugeicons/core-free-icons/BubbleChatAddIcon";
import Link01Icon from "@hugeicons/core-free-icons/Link01Icon";
import type { DelegationRpcContract } from "../../delegate/contract.js";
import { errorMessage } from "../../shared/errors.js";
import { useTasksRpc } from "../../shell/data.js";
import { LinkBeforeStartContent } from "./link-before-start.js";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const ICON_ACTION_CLASS =
  "relative z-10 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-subtle-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 data-[state=open]:text-foreground max-md:pointer-coarse:size-8";

function ActionTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const ACTION_CLASS =
  "relative z-10 flex h-6 shrink-0 items-center gap-1 rounded px-1 text-xs text-subtle-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-60 data-[state=open]:text-foreground";

const SEARCH_DEBOUNCE_MS = 150;

export type ThreadTarget =
  | { kind: "task"; taskId: string }
  | { kind: "project"; projectId: string };

interface ThreadSearchResult {
  id: string;
  title: string;
  status: string;
}

export function NewThreadButton({
  target,
  projectId,
  linked,
  onError,
  className,
  compact = false,
}: {
  target: ThreadTarget;
  projectId: string;
  linked: boolean;
  onError: (message: string) => void;
  className?: string;
  compact?: boolean;
}) {
  const rpc = useRpc<DelegationRpcContract>();
  const splitPanes = experimental_useSplitPanes();
  const navigate = useBbNavigate();
  const [opening, setOpening] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const compose = async () => {
    setOpening(true);
    try {
      const { bbProjectId } =
        target.kind === "task"
          ? await rpc.call("taskThreadsCompose", { taskId: target.taskId })
          : await rpc.call("projectThreadsCompose", {
              projectId: target.projectId,
            });
      const placed = splitPanes.isAvailable
        ? splitPanes.openNewThread({
            side: "right",
            projectId: bbProjectId,
            focusPrompt: true,
            reuseComposer: true,
          })
        : "unavailable";
      if (placed === "unavailable" || placed === "at-cap") {
        navigate.toCompose({ projectId: bbProjectId, focusPrompt: true });
      }
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setOpening(false);
    }
  };

  const start = () => {
    if (linked) void compose();
    else setLinkOpen(true);
  };

  const linkPopover = linkOpen ? (
    <LinkBeforeStartContent
      projectId={projectId}
      onError={onError}
      onLinked={() => {
        setLinkOpen(false);
        void compose();
      }}
    />
  ) : null;

  if (compact) {
    return (
      <Popover open={linkOpen} onOpenChange={setLinkOpen}>
        <ActionTooltip label="New thread">
          <PopoverAnchor asChild>
            <button
              type="button"
              aria-label="New thread"
              aria-busy={opening}
              className={cn(ICON_ACTION_CLASS, className)}
              disabled={opening}
              onClick={start}
            >
              <HugeiconsIcon
                icon={BubbleChatAddIcon}
                className="size-3.5 shrink-0"
              />
            </button>
          </PopoverAnchor>
        </ActionTooltip>
        {linkPopover}
      </Popover>
    );
  }

  return (
    <Popover open={linkOpen} onOpenChange={setLinkOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          className={cn(ACTION_CLASS, className)}
          disabled={opening}
          onClick={start}
        >
          <Icon name="Plus" className="size-3 shrink-0" />
          New thread
        </button>
      </PopoverAnchor>
      {linkPopover}
    </Popover>
  );
}

export function AttachThreadPicker({
  target,
  attachedThreadIds,
  onError,
  className,
  compact = false,
}: {
  target: ThreadTarget;
  attachedThreadIds: readonly string[];
  onError: (message: string) => void;
  className?: string;
  compact?: boolean;
}) {
  const tasksRpc = useTasksRpc();
  const rpc = useRpc<DelegationRpcContract>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ThreadSearchResult[] | null>(null);
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void tasksRpc.call("searchThreads", { query, limit: 10 }).then(
        (result) => {
          if (!cancelled) setResults(result.threads);
        },
        (error: unknown) => {
          if (!cancelled) {
            setResults([]);
            onError(errorMessage(error));
          }
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, tasksRpc, onError]);

  const attach = async (threadId: string) => {
    setAttaching(true);
    try {
      if (target.kind === "task") {
        await rpc.call("taskThreadsAttach", {
          taskId: target.taskId,
          threadId,
        });
      } else {
        await rpc.call("projectThreadsAttach", {
          projectId: target.projectId,
          threadId,
        });
      }
      setOpen(false);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setAttaching(false);
    }
  };

  const attached = new Set(attachedThreadIds);
  const candidates = (results ?? []).filter(
    (thread) => !attached.has(thread.id),
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setResults(null);
        }
      }}
    >
      {compact ? (
        <ActionTooltip label="Attach thread">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Attach thread"
              className={cn(ICON_ACTION_CLASS, className)}
            >
              <HugeiconsIcon icon={Link01Icon} className="size-3.5 shrink-0" />
            </button>
          </PopoverTrigger>
        </ActionTooltip>
      ) : (
        <PopoverTrigger asChild>
          <button type="button" className={cn(ACTION_CLASS, className)}>
            <HugeiconsIcon icon={Link01Icon} className="size-3 shrink-0" />
            Attach thread
          </button>
        </PopoverTrigger>
      )}
      <PopoverContent align="start" className="w-72 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search threads…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {results === null ? "Searching…" : "No matching threads."}
            </CommandEmpty>
            {candidates.length > 0 ? (
              <CommandGroup>
                {candidates.map((thread) => (
                  <CommandItem
                    key={thread.id}
                    value={thread.id}
                    disabled={attaching}
                    onSelect={() => void attach(thread.id)}
                  >
                    <Icon
                      name="MessageSquare"
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {thread.title}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
