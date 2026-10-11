// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { BbNavigate } from "@get-bb/plugin-sdk/app";
import {
  ComposeAnchor,
  openComposerBeside,
  splitComposerRight,
} from "./composer-beside";

afterEach(cleanup);

function captureClicks(handled: boolean) {
  const clicks: MouseEvent[] = [];
  const listener = (event: MouseEvent) => {
    clicks.push(event);
    if (handled) event.preventDefault();
  };
  document.addEventListener("click", listener);
  return {
    clicks,
    dispose: () => document.removeEventListener("click", listener),
  };
}

function fakeNavigate() {
  const calls: unknown[] = [];
  const navigate = {
    toCompose: (options?: unknown) => calls.push(options),
  } as unknown as BbNavigate;
  return { calls, navigate };
}

function renderAnchor(): HTMLAnchorElement {
  const { container } = render(<ComposeAnchor />);
  const anchor = container.querySelector("a");
  if (anchor === null) throw new Error("missing anchor");
  return anchor;
}

describe("splitComposerRight", () => {
  it("sends bb a hidden Cmd-click on its New thread route and reports that bb took it", () => {
    const anchor = renderAnchor();
    const host = captureClicks(true);

    expect(splitComposerRight(anchor)).toBe(true);
    host.dispose();

    expect(anchor.hidden).toBe(true);
    expect(anchor.tabIndex).toBe(-1);
    expect(host.clicks).toHaveLength(1);
    const [click] = host.clicks;
    expect(click?.target).toBe(anchor);
    expect(click?.metaKey).toBe(true);
    expect(click?.button).toBe(0);
    expect(anchor.getAttribute("href")).toBe("/");
  });

  it("reports false and never lets the browser follow the link when bb ignores it", () => {
    const anchor = renderAnchor();
    const host = captureClicks(false);

    expect(splitComposerRight(anchor)).toBe(false);
    host.dispose();

    expect(host.clicks[0]?.defaultPrevented).toBe(true);
  });

  it("does nothing without a mounted anchor", () => {
    const host = captureClicks(true);
    const detached = document.createElement("a");

    expect(splitComposerRight(null)).toBe(false);
    expect(splitComposerRight(detached)).toBe(false);
    host.dispose();

    expect(host.clicks).toEqual([]);
  });
});

describe("openComposerBeside", () => {
  it("splits first, then selects the project and focuses the prompt", () => {
    renderAnchor();
    const host = captureClicks(true);
    const { calls, navigate } = fakeNavigate();

    expect(openComposerBeside(navigate, "proj_a")).toBe(true);
    host.dispose();

    expect(host.clicks).toHaveLength(1);
    expect(calls).toEqual([{ projectId: "proj_a", focusPrompt: true }]);
  });

  it("falls back to bb's New thread screen once the anchor unmounts", () => {
    const { unmount } = render(<ComposeAnchor />);
    unmount();
    const host = captureClicks(true);
    const { calls, navigate } = fakeNavigate();

    expect(openComposerBeside(navigate, null)).toBe(false);
    host.dispose();

    expect(host.clicks).toEqual([]);
    expect(calls).toEqual([{ focusPrompt: true }]);
  });
});
