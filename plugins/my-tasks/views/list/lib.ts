import {
  PROJECT_STATUSES,
  type Label,
  type Priority,
  type Project,
  type ProjectStatus,
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
  return PROJECT_STATUSES.flatMap((status) => {
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
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export const DUE_DATE_PRESETS: readonly [label: string, days: number][] = [
  ["Today", 0],
  ["Tomorrow", 1],
  ["Next week", 7],
];
