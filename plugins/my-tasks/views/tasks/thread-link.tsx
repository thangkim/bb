import { useOpenThreadInSplit } from "../../components/use-open-thread-in-split.js";
import { useActiveThread } from "../../components/active-thread.js";
import { useLiveThreadTitle } from "./live-thread-title.js";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export function ThreadLink({
  threadId,
  title: storedTitle,
  statusLabel,
  working,
  icon = "MessageSquare",
}: {
  threadId: string;
  title: string;
  statusLabel: string | null;
  working: boolean;
  icon?: IconName;
}) {
  const openThread = useOpenThreadInSplit();
  const title = useLiveThreadTitle(threadId, storedTitle);
  const active = useActiveThread().threadId === threadId;
  return (
    <button
      type="button"
      aria-label={statusLabel === null ? title : `${title} — ${statusLabel}`}
      data-active-thread={active || undefined}
      onClick={() => openThread(threadId)}
      className={cn(
        "relative z-10 flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:text-foreground",
        active
          ? "bg-state-active text-foreground"
          : "text-subtle-foreground hover:bg-state-hover",
      )}
    >
      <Icon name={icon} className="size-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {working ? (
        <Icon
          name="RotateCcw"
          className="size-3 shrink-0 animate-spin text-timeline-accent"
        />
      ) : null}
    </button>
  );
}
