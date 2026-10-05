import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { HugeiconsIcon } from "@hugeicons/react";
import BubbleChatAddIcon from "@hugeicons/core-free-icons/BubbleChatAddIcon";
import Link01Icon from "@hugeicons/core-free-icons/Link01Icon";
import type { DelegationRpcContract } from "../../delegate/contract.js";
import type { Preset } from "../../shared/contract.js";
import { errorMessage } from "../../shared/errors.js";
import { useTasksRpc } from "../../shell/data.js";
import { useOpenNewThreadInSplit } from "../../components/use-open-thread-in-split.js";
import { PresetDialog, savePresetDraft } from "../manage/preset-dialog.js";
import { LinkBeforeStartContent } from "./link-before-start.js";
import {
  defaultPreset,
  loadLastPresetId,
  storeLastPresetId,
} from "../detail/last-preset.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

export function NewThreadMenu({
  target,
  presets,
  onError,
  className,
  compact = false,
  unlinkedProjectId = null,
}: {
  target: ThreadTarget;
  presets: Preset[] | undefined;
  onError: (message: string) => void;
  className?: string;
  compact?: boolean;
  unlinkedProjectId?: string | null;
}) {
  const rpc = useRpc<DelegationRpcContract>();
  const tasksRpc = useTasksRpc();
  const openNewThread = useOpenNewThreadInSplit();
  const [dispatching, setDispatching] = useState(false);
  const [lastPresetId, setLastPresetId] = useState(loadLastPresetId);
  const [createDialogKey, setCreateDialogKey] = useState<number | null>(null);
  const current = defaultPreset(presets, lastPresetId);
  const [linkOpen, setLinkOpen] = useState(false);
  const startCurrent = () => {
    if (!current) setCreateDialogKey((key) => (key ?? 0) + 1);
    else if (unlinkedProjectId !== null) setLinkOpen(true);
    else void dispatch(current);
  };

  const startWith = (preset: Preset) => {
    if (unlinkedProjectId === null) {
      void dispatch(preset);
      return;
    }
    setLastPresetId(preset.id);
    storeLastPresetId(preset.id);
    setLinkOpen(true);
  };

  const dispatch = async (preset: Preset) => {
    setLastPresetId(preset.id);
    storeLastPresetId(preset.id);
    setDispatching(true);
    try {
      const { threadId } =
        target.kind === "task"
          ? await rpc.call("delegate", {
              taskId: target.taskId,
              presetId: preset.id,
            })
          : await rpc.call("delegateProject", {
              projectId: target.projectId,
              presetId: preset.id,
            });
      openNewThread(threadId);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setDispatching(false);
    }
  };

  const presetMenuContent = (
    <DropdownMenuContent
      align="start"
      className="min-w-52"
      mobileTitle="New thread"
    >
      <DropdownMenuLabel>Start a thread with preset</DropdownMenuLabel>
      {(presets ?? []).map((preset) => (
        <DropdownMenuItem key={preset.id} onSelect={() => startWith(preset)}>
          <span className="min-w-0 flex-1 truncate">{preset.name}</span>
          <span className="text-xs text-muted-foreground">
            {preset.modelId}
          </span>
          {preset.id === current?.id ? (
            <Icon name="Check" className="size-3.5" />
          ) : null}
        </DropdownMenuItem>
      ))}
      {(presets ?? []).length > 0 ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem onSelect={() => setCreateDialogKey(Date.now())}>
        <Icon name="Plus" className="size-3.5" />
        Add a preset…
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  const createDialog =
    createDialogKey !== null ? (
      <PresetDialog
        key={createDialogKey}
        open
        onOpenChange={(open) => {
          if (!open) setCreateDialogKey(null);
        }}
        editing={null}
        onSave={(draft) => savePresetDraft(tasksRpc, null, draft)}
      />
    ) : null;

  const linkPopover =
    unlinkedProjectId !== null && linkOpen ? (
      <LinkBeforeStartContent
        projectId={unlinkedProjectId}
        onError={onError}
        onLinked={() => {
          setLinkOpen(false);
          if (current) void dispatch(current);
        }}
      />
    ) : null;

  if (compact) {
    const label = dispatching
      ? "Starting thread…"
      : current
        ? `New thread with ${current.name}`
        : "New thread";
    return (
      <>
        <Popover open={linkOpen} onOpenChange={setLinkOpen}>
          <ActionTooltip label={label}>
            <PopoverAnchor asChild>
              <button
                type="button"
                aria-label="New thread"
                aria-busy={dispatching}
                className={cn(ICON_ACTION_CLASS, className)}
                disabled={dispatching || presets === undefined}
                onClick={startCurrent}
              >
                {dispatching ? (
                  <Icon
                    name="RotateCcw"
                    className="size-3 shrink-0 animate-spin text-timeline-accent"
                  />
                ) : (
                  <HugeiconsIcon
                    icon={BubbleChatAddIcon}
                    className="size-3.5 shrink-0"
                  />
                )}
              </button>
            </PopoverAnchor>
          </ActionTooltip>
          {linkPopover}
        </Popover>
        {createDialog}
      </>
    );
  }

  return (
    <>
      <div className={cn("flex items-center", className)}>
        <Popover open={linkOpen} onOpenChange={setLinkOpen}>
          <PopoverAnchor asChild>
            <button
              type="button"
              className={ACTION_CLASS}
              disabled={dispatching || presets === undefined}
              title={current ? `Start with ${current.name}` : undefined}
              onClick={startCurrent}
            >
              <Icon name="Plus" className="size-3 shrink-0" />
              {dispatching ? "Starting…" : "New thread"}
            </button>
          </PopoverAnchor>
          {linkPopover}
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={dispatching}>
            <button
              type="button"
              aria-label="Choose thread preset"
              className={cn(ACTION_CLASS, "px-0.5")}
            >
              <Icon name="ChevronDown" className="size-3 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          {presetMenuContent}
        </DropdownMenu>
      </div>
      {createDialog}
    </>
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
