export const DISPLAY_MODE_OPTIONS = [
  "Chips in the title bar",
  "Vertical strips on the left",
  "Horizontal strips on top",
] as const;

export type DisplayMode = "chips" | "rail" | "bar";

export const DEFAULT_DISPLAY_OPTION = DISPLAY_MODE_OPTIONS[0];

export function parseDisplayMode(value: unknown): DisplayMode {
  if (value === DISPLAY_MODE_OPTIONS[1]) return "rail";
  if (value === DISPLAY_MODE_OPTIONS[2]) return "bar";
  return "chips";
}

export const DISPLAY_MODE_STORAGE_KEY = "bb.pane-collapse.displayMode";

let lastKnownMode: DisplayMode | null = null;

function readStoredMode(): DisplayMode | null {
  try {
    const stored = localStorage.getItem(DISPLAY_MODE_STORAGE_KEY);
    return stored === "chips" || stored === "rail" || stored === "bar"
      ? stored
      : null;
  } catch {
    return null;
  }
}

export function resolveDisplayMode(value: unknown): DisplayMode {
  if (value === undefined) {
    lastKnownMode ??= readStoredMode();
    return lastKnownMode ?? "chips";
  }
  const mode = parseDisplayMode(value);
  if (mode !== lastKnownMode) {
    lastKnownMode = mode;
    try {
      localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, mode);
    } catch {
      return mode;
    }
  }
  return mode;
}

export function resetDisplayModeMemory(): void {
  lastKnownMode = null;
}
