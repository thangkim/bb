import type {
  Label,
  Priority,
  Project,
  ProjectStatus,
} from "../../shared/contract.js";
import type { TaskSort } from "../../shared/pagination.js";

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

export const SORT_LABELS: Record<TaskSort, string> = {
  manual: "Manual",
  priority: "Priority",
  due: "Due date",
};

const LIST_STATUS_ORDER: readonly ProjectStatus[] = [
  "in_progress",
  "in_review",
  "todo",
  "backlog",
  "done",
  "canceled",
];

interface StatusGroup {
  status: ProjectStatus;
  projects: Project[];
}

export function groupProjectsByStatus(
  projects: readonly Project[],
): StatusGroup[] {
  const byStatus = new Map<ProjectStatus, Project[]>();
  for (const project of projects) {
    const bucket = byStatus.get(project.status);
    if (bucket) bucket.push(project);
    else byStatus.set(project.status, [project]);
  }
  return LIST_STATUS_ORDER.flatMap((status) => {
    const bucket = byStatus.get(status);
    return bucket ? [{ status, projects: bucket }] : [];
  });
}

export function progressPercent(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

export function formatDueDate(dueDate: string, today = new Date()): string {
  const date = new Date(`${dueDate}T00:00:00`);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

interface LabelOverflow {
  visible: Label[];
  hidden: Label[];
}

export function partitionLabels(
  labels: readonly Label[],
  maxVisible: number,
): LabelOverflow {
  if (labels.length <= maxVisible) {
    return { visible: [...labels], hidden: [] };
  }
  return {
    visible: labels.slice(0, maxVisible),
    hidden: labels.slice(maxVisible),
  };
}

export function localIsoDate(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return isoFromDate(date);
}

export const DUE_DATE_PRESETS: readonly [label: string, days: number][] = [
  ["Today", 0],
  ["Tomorrow", 1],
  ["Next week", 7],
];

export interface CalendarDay {
  iso: string;
  day: number;
  inMonth: boolean;
}

export interface CalendarMonth {
  year: number;
  month: number;
}

function isoFromDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function calendarMonthOf(iso: string): CalendarMonth {
  const date = new Date(`${iso}T00:00:00`);
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function shiftCalendarMonth(
  { year, month }: CalendarMonth,
  delta: number,
): CalendarMonth {
  const date = new Date(year, month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function calendarWeeks({ year, month }: CalendarMonth): CalendarDay[][] {
  const first = new Date(year, month, 1);
  const leading = (first.getDay() + 6) % 7;
  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const days: CalendarDay[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = new Date(year, month, 1 - leading + week * 7 + weekday);
      days.push({
        iso: isoFromDate(date),
        day: date.getDate(),
        inMonth: date.getMonth() === month,
      });
    }
    weeks.push(days);
  }
  return weeks;
}
