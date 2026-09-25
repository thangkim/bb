// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { findTextMatches } from "./thread-find-matches";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("findTextMatches", () => {
  it("matches case-insensitively, including across inline elements", () => {
    const root = mount("<p>Deploy the <b>serv</b>er now</p><p>SERVER</p>");

    const ranges = findTextMatches(root, "server");

    expect(ranges.map((range) => range.toString())).toEqual([
      "server",
      "SERVER",
    ]);
    expect(ranges[0]?.startContainer.textContent).toBe("serv");
    expect(ranges[0]?.endContainer.textContent).toBe("er now");
  });

  it("skips hidden and excluded subtrees", () => {
    const root = mount(
      '<p>match</p><div hidden><p>match</p></div><div data-skip=""><p>match</p></div>',
    );

    const ranges = findTextMatches(
      root,
      "match",
      (element) => element.closest("[data-skip]") !== null,
    );

    expect(ranges).toHaveLength(1);
  });

  it("does not report overlapping matches or empty queries", () => {
    const root = mount("<p>aaaa</p>");

    expect(findTextMatches(root, "aa")).toHaveLength(2);
    expect(findTextMatches(root, "")).toEqual([]);
  });
});
