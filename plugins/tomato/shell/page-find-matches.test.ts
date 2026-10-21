// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { findTextMatches, findTextOffsets } from "./page-find-matches.js";

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

describe("findTextOffsets", () => {
  it("matches case-insensitively without overlapping", () => {
    expect(findTextOffsets("Aaaa aA", "aa")).toEqual([0, 2, 5]);
  });

  it("finds nothing for an empty query", () => {
    expect(findTextOffsets("anything", "")).toEqual([]);
  });
});

describe("findTextMatches", () => {
  it("matches text split across inline elements", () => {
    const root = mount("<p>Pulse <b>Gym</b> demo</p><p>gym again</p>");

    const ranges = findTextMatches(root, "pulse gym");
    expect(ranges.map((range) => range.toString())).toEqual(["Pulse Gym"]);
    expect(findTextMatches(root, "gym")).toHaveLength(2);
  });

  it("skips excluded subtrees and hidden elements", () => {
    const root = mount(
      "<p>needle</p><div data-skip><p>needle</p></div><p hidden>needle</p>",
    );

    const ranges = findTextMatches(
      root,
      "needle",
      (element) => element.closest("[data-skip]") !== null,
    );
    expect(ranges).toHaveLength(1);
  });
});
