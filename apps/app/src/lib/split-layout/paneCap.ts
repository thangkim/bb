import { getPluginMinimizedThreadIds } from "../plugin-minimized-threads";
import { countActivePanes, MAX_PANES } from "./ops";
import type { LayoutNode } from "./types";

export function isAtThreadPaneCap(root: LayoutNode): boolean {
  return countActivePanes(root, getPluginMinimizedThreadIds()) >= MAX_PANES;
}
