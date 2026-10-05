export const SHOW_COMPLETED_TASKS_SETTING = "showCompletedTasks";

export function readShowCompletedTasks(
  values: Record<string, string | number | boolean> | undefined,
): boolean {
  return values?.[SHOW_COMPLETED_TASKS_SETTING] === true;
}
