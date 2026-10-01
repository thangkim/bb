export const COMPOSER_SHELL_SELECTOR = "[data-promptbox-shell]";
export const FOCUSED_DIFF_REFRESH_EVENT = "bb-plugin-focused-diff:refresh";

const CHANGED_FILE_BUTTON_SELECTOR =
  '#thread-prompt-banner-git-body button[aria-label^="Open "]';
const OPEN_LABEL_PREFIX = "Open ";
const PREVIEW_STATUS_LABELS = new Set(["A", "A?", "D"]);

export function readChangedFileClickPath(
  event: Pick<
    MouseEvent,
    "target" | "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
  >,
  shell: Element,
): string | null {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    !(event.target instanceof Element)
  ) {
    return null;
  }
  const button = event.target.closest(CHANGED_FILE_BUTTON_SELECTOR);
  if (button === null || !shell.contains(button)) return null;
  const path = (button.getAttribute("aria-label") ?? "")
    .slice(OPEN_LABEL_PREFIX.length)
    .trim();
  if (path === "") return null;
  const statusLabel = button.firstElementChild?.textContent?.trim() ?? "";
  return PREVIEW_STATUS_LABELS.has(statusLabel) ? null : path;
}

export function fileName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}
