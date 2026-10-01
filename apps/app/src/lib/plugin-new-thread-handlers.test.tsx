// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalNewThreadHandler } from "@get-bb/plugin-sdk";
import {
  offerNewThreadRequest,
  useNewThreadHandler,
} from "./plugin-new-thread-handlers";

afterEach(cleanup);

const REQUEST = { projectId: "proj_a", focusPrompt: true };

function mount(handler: ExperimentalNewThreadHandler | null) {
  return renderHook(
    ({ current }: { current: ExperimentalNewThreadHandler | null }) =>
      useNewThreadHandler(current),
    { initialProps: { current: handler } },
  );
}

describe("offerNewThreadRequest", () => {
  it("is declined when no handler is mounted", () => {
    expect(offerNewThreadRequest(REQUEST)).toBe(false);
  });

  it("stops at the first handler that takes the request, in mount order", () => {
    const declines = vi.fn(() => false);
    const takes = vi.fn(() => true);
    const later = vi.fn(() => true);
    mount(declines);
    mount(takes);
    mount(later);

    expect(offerNewThreadRequest(REQUEST)).toBe(true);

    expect(declines).toHaveBeenCalledWith(REQUEST);
    expect(takes).toHaveBeenCalledWith(REQUEST);
    expect(later).not.toHaveBeenCalled();
  });

  it("skips a handler that throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mount(() => {
      throw new Error("boom");
    });
    const takes = vi.fn(() => true);
    mount(takes);

    expect(offerNewThreadRequest(REQUEST)).toBe(true);

    expect(takes).toHaveBeenCalled();
    error.mockRestore();
  });

  it("uses the latest handler and keeps its place when it changes", () => {
    const first = mount(() => false);
    const second = vi.fn(() => true);
    mount(second);
    const replacement = vi.fn(() => true);
    first.rerender({ current: replacement });

    expect(offerNewThreadRequest(REQUEST)).toBe(true);

    expect(replacement).toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("stops offering requests after unmount or a null handler", () => {
    const unmounted = vi.fn(() => true);
    mount(unmounted).unmount();
    const cleared = vi.fn(() => true);
    mount(cleared).rerender({ current: null });

    expect(offerNewThreadRequest(REQUEST)).toBe(false);

    expect(unmounted).not.toHaveBeenCalled();
    expect(cleared).not.toHaveBeenCalled();
  });
});
