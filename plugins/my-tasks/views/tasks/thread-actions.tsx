import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { HugeiconsIcon } from "@hugeicons/react";
import Link01Icon from "@hugeicons/core-free-icons/Link01Icon";
import type { DelegationRpcContract } from "../../delegate/contract.js";
import type { Preset } from "../../shared/contract.js";
import { errorMessage } from "../../shared/errors.js";
import { useTasksRpc } from "../../shell/data.js";
import { PresetDialog, savePresetDraft } from "../manage/preset-dialog.js";
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
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const ACTION_CLASS =
  "relative z-10 flex h-6 shrink-0 items-center gap-1 rounded px-1 text-xs text-subtle-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-60 data-[state=open]:text-foreground";

const SEARCH_DEBOUNCE_MS = 150;

interface ThreadSearchResult {
  id: string;
  title: string;
  status: string;
}

export function NewThreadMenu({
  taskId,
  presets,
  onError,
  className,
}: {
  taskId: string;
  presets: Preset[] | undefined;
  onError: (message: string) => void;
  className?: string;
}) {
  const rpc = useRpc<DelegationRpcContract>();
  const tasksRpc = useTasksRpc();
  const [dispatching, setDispatching] = useState(false);
  const [lastPresetId, setLastPresetId] = useState(loadLastPresetId);
  const [createDialogKey, setCreateDialogKey] = useState<number | null>(null);
  const current = defaultPreset(presets, lastPresetId);

  const dispatch = async (preset: Preset) => {
    setLastPresetId(preset.id);
    storeLastPresetId(preset.id);
    setDispatching(true);
    try {
      await rpc.call("delegate", { taskId, presetId: preset.id });
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setDispatching(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={dispatching}>
          <button type="button" className={cn(ACTION_CLASS, className)}>
            <Icon name="Plus" className="size-3 shrink-0" />
            {dispatching ? "Starting…" : "New thread"}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-52"
          mobileTitle="New thread"
        >
          <DropdownMenuLabel>Start a thread with preset</DropdownMenuLabel>
          {(presets ?? []).map((preset) => (
            <DropdownMenuItem
              key={preset.id}
              onSelect={() => void dispatch(preset)}
            >
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
      </DropdownMenu>
      {createDialogKey !== null ? (
        <PresetDialog
          key={createDialogKey}
          open
          onOpenChange={(open) => {
            if (!open) setCreateDialogKey(null);
          }}
          editing={null}
          onSave={(draft) => savePresetDraft(tasksRpc, null, draft)}
        />
      ) : null}
    </>
  );
}

export function AttachThreadPicker({
  taskId,
  attachedThreadIds,
  onError,
  className,
}: {
  taskId: string;
  attachedThreadIds: readonly string[];
  onError: (message: string) => void;
  className?: string;
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
      await rpc.call("taskThreadsAttach", { taskId, threadId });
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
      <PopoverTrigger asChild>
        <button type="button" className={cn(ACTION_CLASS, className)}>
          <HugeiconsIcon icon={Link01Icon} className="size-3 shrink-0" />
          Attach thread
        </button>
      </PopoverTrigger>
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
