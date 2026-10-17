// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { migrateLegacyStorageKeys } from "./legacy-storage.js";

afterEach(() => {
  window.localStorage.clear();
});

describe("migrateLegacyStorageKeys", () => {
  it("moves My Tasks keys to Tomato keys and keeps newer Tomato values", () => {
    window.localStorage.setItem("bb-my-tasks:pane-width", "420");
    window.localStorage.setItem("bb-my-tasks:project-list-scroll:all", "80");
    window.localStorage.setItem("bb-my-tasks:view-preference", "board");
    window.localStorage.setItem("bb-tomato:view-preference", "list");
    window.localStorage.setItem("bb-tasks:query-snapshot:v1:projects", "[]");

    migrateLegacyStorageKeys();

    expect(window.localStorage.getItem("bb-tomato:pane-width")).toBe("420");
    expect(
      window.localStorage.getItem("bb-tomato:project-list-scroll:all"),
    ).toBe("80");
    expect(window.localStorage.getItem("bb-tomato:view-preference")).toBe(
      "list",
    );
    expect(
      window.localStorage.getItem("bb-tasks:query-snapshot:v1:projects"),
    ).toBe("[]");
    expect(
      Object.keys(window.localStorage).filter((key) =>
        key.startsWith("bb-my-tasks:"),
      ),
    ).toEqual([]);
  });
});
