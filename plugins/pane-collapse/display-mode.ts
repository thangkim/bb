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
