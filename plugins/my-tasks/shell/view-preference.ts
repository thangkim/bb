import type { TaskViewMode } from "./routes.js";

export const VIEW_PREFERENCE_STORAGE_KEY = "bb-my-tasks:view-preference";

const DEFAULT_VIEW_MODE: TaskViewMode = "list";

export function loadViewMode(): TaskViewMode {
  try {
    const stored = window.localStorage.getItem(VIEW_PREFERENCE_STORAGE_KEY);
    return stored === "board" || stored === "list" ? stored : DEFAULT_VIEW_MODE;
  } catch {
    return DEFAULT_VIEW_MODE;
  }
}

export function storeViewMode(view: TaskViewMode): void {
  try {
    window.localStorage.setItem(VIEW_PREFERENCE_STORAGE_KEY, view);
  } catch {}
}
