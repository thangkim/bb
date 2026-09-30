import type { Preset } from "../../shared/contract.js";

const LAST_PRESET_STORAGE_KEY = "bb-tasks:last-dispatch-preset";

export function loadLastPresetId(): string | null {
  try {
    return window.localStorage.getItem(LAST_PRESET_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeLastPresetId(presetId: string): void {
  try {
    window.localStorage.setItem(LAST_PRESET_STORAGE_KEY, presetId);
  } catch {}
}

export function defaultPreset(
  presets: readonly Preset[] | undefined,
  lastPresetId: string | null,
): Preset | undefined {
  if (presets === undefined) return undefined;
  return (
    presets.find((preset) => preset.id === lastPresetId) ??
    [...presets].sort((a, b) => a.name.localeCompare(b.name))[0]
  );
}
