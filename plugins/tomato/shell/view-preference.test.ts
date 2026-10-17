// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  VIEW_PREFERENCE_STORAGE_KEY,
  loadViewMode,
  storeViewMode,
} from "./view-preference.js";

beforeEach(() => window.localStorage.clear());

describe("view preference storage", () => {
  it("falls back to the list before anything is stored", () => {
    expect(loadViewMode()).toBe("list");
  });

  it("remembers the last chosen view", () => {
    storeViewMode("board");
    expect(loadViewMode()).toBe("board");
    storeViewMode("list");
    expect(loadViewMode()).toBe("list");
  });

  it("ignores values it does not recognize", () => {
    window.localStorage.setItem(VIEW_PREFERENCE_STORAGE_KEY, "kanban");
    expect(loadViewMode()).toBe("list");
  });
});
