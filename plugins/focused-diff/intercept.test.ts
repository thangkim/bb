// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { fileName, readChangedFileClickPath } from "./intercept.js";

function renderComposer(rows: { status: string; path: string }[]) {
  const shell = document.createElement("div");
  shell.setAttribute("data-promptbox-shell", "");
  const body = document.createElement("div");
  body.id = "thread-prompt-banner-git-body";
  for (const row of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `Open ${row.path}`);
    const status = document.createElement("span");
    status.textContent = row.status;
    const path = document.createElement("span");
    path.textContent = row.path;
    button.append(status, path);
    body.append(button);
  }
  shell.append(body);
  document.body.append(shell);
  return shell;
}

function primaryClick(target: Element, overrides: Partial<MouseEvent> = {}) {
  return {
    target,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("readChangedFileClickPath", () => {
  it("reads the path of a modified file from a click anywhere in its row", () => {
    const shell = renderComposer([
      { status: "M", path: "app/[id].vue" },
      { status: "R", path: "src/renamed.ts" },
    ]);
    const [first, second] = shell.querySelectorAll("button");
    expect(
      readChangedFileClickPath(primaryClick(first!.lastElementChild!), shell),
    ).toBe("app/[id].vue");
    expect(readChangedFileClickPath(primaryClick(second!), shell)).toBe(
      "src/renamed.ts",
    );
  });

  it("leaves added, untracked, and deleted files to bb's own file preview", () => {
    const shell = renderComposer([
      { status: "A", path: "new.ts" },
      { status: "A?", path: ".env.bak" },
      { status: "D", path: "gone.ts" },
    ]);
    for (const button of shell.querySelectorAll("button")) {
      expect(readChangedFileClickPath(primaryClick(button), shell)).toBeNull();
    }
  });

  it("ignores modified clicks and rows that belong to another composer", () => {
    const shell = renderComposer([{ status: "M", path: "a.ts" }]);
    const otherShell = renderComposer([{ status: "M", path: "b.ts" }]);
    const button = shell.querySelector("button")!;
    expect(
      readChangedFileClickPath(primaryClick(button, { metaKey: true }), shell),
    ).toBeNull();
    expect(
      readChangedFileClickPath(primaryClick(button, { button: 1 }), shell),
    ).toBeNull();
    expect(
      readChangedFileClickPath(
        primaryClick(otherShell.querySelector("button")!),
        shell,
      ),
    ).toBeNull();
  });

  it("ignores buttons outside the changed-files list", () => {
    const shell = renderComposer([]);
    const stray = document.createElement("button");
    stray.setAttribute("aria-label", "Open settings");
    shell.append(stray);
    expect(readChangedFileClickPath(primaryClick(stray), shell)).toBeNull();
  });
});

describe("fileName", () => {
  it("returns the last path segment", () => {
    expect(fileName("packages/a/MoveAmlNodeModal.vue")).toBe(
      "MoveAmlNodeModal.vue",
    );
    expect(fileName("README.md")).toBe("README.md");
  });
});
