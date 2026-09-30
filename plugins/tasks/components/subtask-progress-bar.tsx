import { cn } from "@/lib/utils";

export function subtaskProgressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

interface SubtaskProgressBarProps {
  done: number;
  total: number;
  active?: boolean;
  className?: string;
}

export function SubtaskProgressBar({
  done,
  total,
  active = false,
  className,
}: SubtaskProgressBarProps) {
  const percent = subtaskProgressPercent(done, total);
  return (
    <span
      title={
        active
          ? `${done}/${total} sub-tasks done · agent working`
          : `${done}/${total} sub-tasks done`
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
