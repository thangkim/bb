// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { formatVisitedAt, readRecentLinks } from "./recents.js";

function storeHistory(threadId: string, entries: unknown) {
  window.localStorage.setItem(
    `bb.thread.browserHistory-${threadId}-1`,
    JSON.stringify(entries),
  );
}

afterEach(() => {
  window.localStorage.clear();
});

describe("readRecentLinks", () => {
  it("merges every thread's history newest first", () => {
    storeHistory("thr_a", [
      { url: "https://a.dev/", title: "A", visitedAt: 10 },
      { url: "https://c.dev/", title: null, visitedAt: 30 },
    ]);
    storeHistory("thr_b", [{ url: "https://b.dev/", title: "B", visitedAt: 20 }]);
    expect(readRecentLinks(window.localStorage).map((link) => link.url)).toEqual(
      ["https://c.dev/", "https://b.dev/", "https://a.dev/"],
    );
  });

  it("keeps one row per URL with its latest visit and a known title", () => {
    storeHistory("thr_a", [
      { url: "https://a.dev/", title: "Old title", visitedAt: 10 },
    ]);
    storeHistory("thr_b", [{ url: "https://a.dev/", title: null, visitedAt: 50 }]);
    expect(readRecentLinks(window.localStorage)).toEqual([
      { url: "https://a.dev/", title: "Old title", visitedAt: 50 },
    ]);
  });

  it("caps the list at eight links", () => {
    storeHistory(
      "thr_a",
      Array.from({ length: 12 }, (_, index) => ({
        url: `https://site${index}.dev/`,
        title: null,
        visitedAt: index,
      })),
    );
    const links = readRecentLinks(window.localStorage);
    expect(links).toHaveLength(8);
    expect(links[0]?.url).toBe("https://site11.dev/");
  });

  it("skips malformed values, bad entries, and unrelated keys", () => {
    window.localStorage.setItem("bb.thread.browserHistory-thr_x-1", "{not json");
    window.localStorage.setItem(
      "other.key",
      JSON.stringify([{ url: "https://x.dev/", title: null, visitedAt: 99 }]),
    );
    storeHistory("thr_a", [
      { url: "", title: null, visitedAt: 5 },
      { url: "https://a.dev/", title: "  ", visitedAt: "soon" },
      { url: "https://ok.dev/", title: "  ", visitedAt: 1 },
      null,
    ]);
    expect(readRecentLinks(window.localStorage)).toEqual([
      { url: "https://ok.dev/", title: null, visitedAt: 1 },
    ]);
  });
});

describe("formatVisitedAt", () => {
  it("uses the same short relative labels as bb", () => {
    const now = 10 * 24 * 60 * 60_000;
    expect(formatVisitedAt(now - 1_000, now)).toBe("just now");
    expect(formatVisitedAt(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatVisitedAt(now - 3 * 60 * 60_000, now)).toBe("3h ago");
    expect(formatVisitedAt(now - 30 * 60 * 60_000, now)).toBe("Yesterday");
    expect(formatVisitedAt(now - 3 * 24 * 60 * 60_000, now)).toBe("3d ago");
  });
});
