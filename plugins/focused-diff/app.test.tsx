// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app.js"));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderFileDiff() {
  const registration = app.threadPanelActions[0];
  if (!registration) throw new Error("Expected the file diff panel");
  return renderSlot(
    registration,
    { threadId: "thread-1", params: { path: "src/a.ts" } },
    {
      sdk: {
        threads: {
          get: async () => makeThreadResponse({ environmentId: "env-1" }),
        },
        environments: {
          get: async () => ({
            id: "env-1",
            name: null,
            projectId: "project-1",
            hostId: "host-1",
            path: "/workspace",
            isGitRepo: true,
            isWorktree: true,
            branchName: "feature",
            baseBranch: "main",
            defaultBranch: "main",
            mergeBaseBranch: null,
            status: "ready",
            environmentProviderId: null,
            environmentProviderSelection: null,
            environmentProviderInstanceKey: null,
            lifecycle: { phase: "active", retireAt: null, teardown: null },
            hostLifecycle: "active",
            managed: true,
            workspaceProvisionType: "managed-worktree",
            createdAt: 0,
            updatedAt: 0,
          }),
          diffPatch: async () => ({
            outcome: "available",
            patches: [
              {
                path: "src/a.ts",
                patch: "@@ -1 +1 @@\n-a\n+b\n",
                truncated: false,
              },
            ],
          }),
        },
      },
    },
  );
}

describe("focused diff app", () => {
  it("registers a thread-only composer interceptor and a flush file diff tab", () => {
    expect(app.composerCustomizations).toEqual([
      expect.objectContaining({
        id: "changed-file-clicks",
        scopes: ["thread"],
      }),
    ]);
    expect(app.threadPanelActions).toEqual([
      expect.objectContaining({ id: "file", layout: "flush" }),
    ]);
  });

  it("explains how to use the tab when opened without a file", async () => {
    const registration = app.threadPanelActions[0];
    if (!registration) throw new Error("Expected the file diff panel");
    const slot = renderSlot(registration, {
      threadId: "thread-1",
      params: null,
    });
    expect(
      await slot.findByText(
        "Click a changed file above the composer to see only its diff here.",
      ),
    ).toBeTruthy();
  });

  it("switches between unified and split views and remembers the choice", async () => {
    const first = renderFileDiff();
    expect((await first.findByTestId("bb-diff")).dataset.view).toBe("unified");

    fireEvent.click(first.getByRole("button", { name: "Split diff view" }));
    expect(first.getByTestId("bb-diff").dataset.view).toBe("split");
    expect(
      first
        .getByRole("button", { name: "Split diff view" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    first.unmount();

    const second = renderFileDiff();
    expect((await second.findByTestId("bb-diff")).dataset.view).toBe("split");
    fireEvent.click(second.getByRole("button", { name: "Unified diff view" }));
    expect(second.getByTestId("bb-diff").dataset.view).toBe("unified");
  });
});
