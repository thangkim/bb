import { describe, expect, it, vi } from "vitest";
import {
  clearPluginMinimizedThreadIds,
  clearPluginMinimizedThreadIdsByOwner,
  getPluginMinimizedThreadIds,
  normalizeMinimizedThreadIds,
  resetPluginMinimizedThreadIdsForTest,
  setPluginMinimizedThreadIds,
  subscribePluginMinimizedThreadIds,
} from "./plugin-minimized-threads";

describe("plugin minimized thread ids", () => {
  it("replaces an owner's report and notifies only when the union changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePluginMinimizedThreadIds(listener);
    const owner = Symbol("pane-collapse-generation");

    setPluginMinimizedThreadIds(
      "pane-collapse",
      owner,
      new Set(["thr_1", "thr_2"]),
    );
    expect([...getPluginMinimizedThreadIds()].sort()).toEqual([
      "thr_1",
      "thr_2",
    ]);
    expect(listener).toHaveBeenCalledTimes(1);

    setPluginMinimizedThreadIds("pane-collapse", owner, new Set(["thr_2"]));
    expect([...getPluginMinimizedThreadIds()]).toEqual(["thr_2"]);
    expect(listener).toHaveBeenCalledTimes(2);

    setPluginMinimizedThreadIds("pane-collapse", owner, new Set(["thr_2"]));
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    resetPluginMinimizedThreadIdsForTest();
  });

  it("keeps siblings when one generation clears or a plugin deactivates", () => {
    const first = Symbol("generation-1");
    const second = Symbol("generation-2");
    setPluginMinimizedThreadIds("pane-collapse", first, new Set(["thr_1"]));
    setPluginMinimizedThreadIds("other-plugin", second, new Set(["thr_2"]));

    clearPluginMinimizedThreadIdsByOwner(first);
    expect([...getPluginMinimizedThreadIds()]).toEqual(["thr_2"]);

    setPluginMinimizedThreadIds("pane-collapse", first, new Set(["thr_3"]));
    clearPluginMinimizedThreadIds("pane-collapse");
    expect([...getPluginMinimizedThreadIds()]).toEqual(["thr_2"]);

    resetPluginMinimizedThreadIdsForTest();
  });

  it("accepts only a set of non-empty strings and trims them", () => {
    expect(normalizeMinimizedThreadIds(new Set([" thr_1 "]))).toEqual(
      new Set(["thr_1"]),
    );
    expect(normalizeMinimizedThreadIds(["thr_1"])).toBeNull();
    expect(normalizeMinimizedThreadIds(new Set([""]))).toBeNull();
    expect(normalizeMinimizedThreadIds(new Set([42]))).toBeNull();
  });
});
