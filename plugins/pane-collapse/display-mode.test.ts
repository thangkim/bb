// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISPLAY_MODE_STORAGE_KEY,
  resetDisplayModeMemory,
  resolveDisplayMode,
} from "./display-mode";

const storageEntries = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => storageEntries.get(key) ?? null,
  setItem: (key: string, value: string) => void storageEntries.set(key, value),
  removeItem: (key: string) => void storageEntries.delete(key),
  clear: () => storageEntries.clear(),
};

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage);
});

afterEach(() => {
  resetDisplayModeMemory();
  storageEntries.delete(DISPLAY_MODE_STORAGE_KEY);
});

describe("resolveDisplayMode", () => {
  it("keeps the last known mode while settings are loading", () => {
    expect(resolveDisplayMode("Horizontal strips on top")).toBe("bar");
    expect(resolveDisplayMode(undefined)).toBe("bar");
    expect(resolveDisplayMode("Vertical strips on the left")).toBe("rail");
    expect(resolveDisplayMode(undefined)).toBe("rail");
  });

  it("restores the stored mode after a reload before settings arrive", () => {
    resolveDisplayMode("Horizontal strips on top");
    resetDisplayModeMemory();
    expect(resolveDisplayMode(undefined)).toBe("bar");
  });

  it("defaults to chips when nothing is known", () => {
    expect(resolveDisplayMode(undefined)).toBe("chips");
  });
});
