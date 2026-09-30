// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LIST_PREFERENCE,
  LIST_PREFERENCE_STORAGE_KEY,
  LIST_PREFERENCE_VERSION,
  loadListPreference,
  sanitizeListPreference,
  storeListPreference,
} from "./list-preference.js";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const EMPTY = { filters: { statuses: [], priorities: [] }, sort: "manual" };

describe("sanitizeListPreference", () => {
  it("returns defaults for missing or garbage input", () => {
    expect(sanitizeListPreference(undefined)).toEqual(EMPTY);
    expect(sanitizeListPreference(null)).toEqual(EMPTY);
    expect(sanitizeListPreference("nope")).toEqual(EMPTY);
  });

  it("keeps valid project statuses and priorities once, and drops the rest", () => {
    expect(
      sanitizeListPreference({
        filters: {
          statuses: ["in_review", "not-a-status", "in_review", "canceled"],
          priorities: ["high", 3, "high", "telepathic"],
          labelNames: ["Bug"],
        },
        sort: "priority-please",
      }),
    ).toEqual({
      filters: { statuses: ["in_review", "canceled"], priorities: ["high"] },
      sort: "manual",
    });
  });

  it("keeps a valid sort", () => {
    expect(sanitizeListPreference({ sort: "due" }).sort).toBe("due");
  });
});

describe("list preference storage", () => {
  it("round-trips each scope independently", () => {
    storeListPreference("all", {
      filters: { statuses: ["in_progress"], priorities: [] },
      sort: "priority",
    });
    storeListPreference("active", {
      filters: { statuses: [], priorities: ["urgent"] },
      sort: "due",
    });

    expect(loadListPreference("all")).toEqual({
      filters: { statuses: ["in_progress"], priorities: [] },
      sort: "priority",
    });
    expect(loadListPreference("active")).toEqual({
      filters: { statuses: [], priorities: ["urgent"] },
      sort: "due",
    });
  });

  it("falls back to defaults for corrupt or older documents", () => {
    window.localStorage.setItem(LIST_PREFERENCE_STORAGE_KEY, "{not json");
    expect(loadListPreference("all")).toEqual(DEFAULT_LIST_PREFERENCE);

    window.localStorage.setItem(
      LIST_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        version: LIST_PREFERENCE_VERSION - 1,
        scopes: { all: { sort: "due" } },
      }),
    );
    expect(loadListPreference("all")).toEqual(DEFAULT_LIST_PREFERENCE);
  });

  it("never overwrites a document written by a newer version", () => {
    const future = JSON.stringify({
      version: LIST_PREFERENCE_VERSION + 1,
      scopes: { all: { sort: "due" } },
    });
    window.localStorage.setItem(LIST_PREFERENCE_STORAGE_KEY, future);
    storeListPreference("all", DEFAULT_LIST_PREFERENCE);
    expect(window.localStorage.getItem(LIST_PREFERENCE_STORAGE_KEY)).toBe(
      future,
    );
  });

  it("swallows storage failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() =>
      storeListPreference("all", DEFAULT_LIST_PREFERENCE),
    ).not.toThrow();
  });
});
