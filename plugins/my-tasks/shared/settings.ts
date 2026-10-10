export const SHOW_COMPLETED_TASKS_SETTING = "showCompletedTasks";

export function readShowCompletedTasks(
  values: Record<string, string | number | boolean> | undefined,
): boolean {
  return values?.[SHOW_COMPLETED_TASKS_SETTING] === true;
}

export const SHOW_COLLAPSED_PROJECT_THREADS_SETTING =
  "showCollapsedProjectThreads";

export function readShowCollapsedProjectThreads(
  values: Record<string, string | number | boolean> | undefined,
): boolean {
  return values?.[SHOW_COLLAPSED_PROJECT_THREADS_SETTING] === true;
}
