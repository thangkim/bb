// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COLLAPSED_FOLDERS_STORAGE_KEY,
  COLLAPSED_STATUSES_STORAGE_KEY,
  EXPANDED_PROJECTS_STORAGE_KEY,
  parseToggleSet,
  usePersistedToggleSet,
} from "./collapse-state.js";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("persisted collapse state", () => {
  it("parses only non-empty string ids and ignores malformed values", () => {
    expect([...parseToggleSet(null)]).toEqual([]);
    expect([...parseToggleSet("{not json")]).toEqual([]);
    expect([...parseToggleSet('{"todo":true}')]).toEqual([]);
    expect([...parseToggleSet('["todo", 3, null, "", "todo", "done"]')]).toEqual(
      ["todo", "done"],
    );
  });

  it("starts empty when the stored value is malformed", () => {
    window.localStorage.setItem(COLLAPSED_STATUSES_STORAGE_KEY, "{not json");
    const { result } = renderHook(() =>
      usePersistedToggleSet(COLLAPSED_STATUSES_STORAGE_KEY),
    );
    expect(result.current[0].size).toBe(0);
    act(() => result.current[1]("todo"));
    expect(
      JSON.parse(
        window.localStorage.getItem(COLLAPSED_STATUSES_STORAGE_KEY) ?? "null",
      ),
    ).toEqual(["todo"]);
  });

  it("survives a remount and toggles back off", () => {
    const first = renderHook(() =>
      usePersistedToggleSet(EXPANDED_PROJECTS_STORAGE_KEY),
    );
    act(() => first.result.current[1]("p1"));
    first.unmount();

    const second = renderHook(() =>
      usePersistedToggleSet(EXPANDED_PROJECTS_STORAGE_KEY),
    );
    expect(second.result.current[0].has("p1")).toBe(true);
    act(() => second.result.current[1]("p1"));
    expect(second.result.current[0].has("p1")).toBe(false);
    expect(
      window.localStorage.getItem(EXPANDED_PROJECTS_STORAGE_KEY),
    ).toBe("[]");
  });

  it("keeps ids toggled by sibling components instead of overwriting them", () => {
    const a = renderHook(() =>
      usePersistedToggleSet(EXPANDED_PROJECTS_STORAGE_KEY),
    );
    const b = renderHook(() =>
      usePersistedToggleSet(EXPANDED_PROJECTS_STORAGE_KEY),
    );
    act(() => a.result.current[1]("p1"));
    act(() => b.result.current[1]("p2"));
    expect([...a.result.current[0]].sort()).toEqual(["p1", "p2"]);
    expect([...b.result.current[0]].sort()).toEqual(["p1", "p2"]);
  });

  it("keeps each storage key independent", () => {
    const folders = renderHook(() =>
      usePersistedToggleSet(COLLAPSED_FOLDERS_STORAGE_KEY),
    );
    const statuses = renderHook(() =>
      usePersistedToggleSet(COLLAPSED_STATUSES_STORAGE_KEY),
    );
    act(() => folders.result.current[1]("todo"));
    expect(statuses.result.current[0].has("todo")).toBe(false);
  });

  it("still toggles for the session when client storage rejects writes", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is disabled", "SecurityError");
    });
    const { result } = renderHook(() =>
      usePersistedToggleSet(COLLAPSED_FOLDERS_STORAGE_KEY),
    );
    act(() => result.current[1]("f1"));
    expect(result.current[0].has("f1")).toBe(true);
    act(() => result.current[1]("f1"));
    expect(result.current[0].has("f1")).toBe(false);
  });

  it("picks up changes written by another tab", () => {
    const { result } = renderHook(() =>
      usePersistedToggleSet(COLLAPSED_STATUSES_STORAGE_KEY),
    );
    act(() => {
      window.localStorage.setItem(
        COLLAPSED_STATUSES_STORAGE_KEY,
        JSON.stringify(["done"]),
      );
      window.dispatchEvent(
        new StorageEvent("storage", { key: COLLAPSED_STATUSES_STORAGE_KEY }),
      );
    });
    expect(result.current[0].has("done")).toBe(true);
  });
});
