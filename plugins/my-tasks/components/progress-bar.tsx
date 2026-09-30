import { cn } from "@/lib/utils";
import { progressPercent } from "../views/list/lib.js";

interface ProgressBarProps {
  done: number;
  total: number;
  active?: boolean;
  className?: string;
}

export function ProgressBar({
  done,
  total,
  active = false,
  className,
}: ProgressBarProps) {
  const percent = progressPercent(done, total);
  return (
    <span
      title={
        active
          ? `${done}/${total} tasks done · agent working`
          : `${done}/${total} tasks done`
      }
      className={cn("inline-flex shrink-0 items-center gap-1.5", className)}
    >
      <span
        aria-hidden
        className="relative h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-muted"
      >
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full bg-primary",
            active && "animate-pulse",
          )}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="tabular-nums">{percent}%</span>
    </span>
  );
}
