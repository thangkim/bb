import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createStore } from "../api";
import { registerProjectMentions } from "./project-mentions";

function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  const store = createStore(bb);
  registerProjectMentions(bb, store);
  const provider = harness.registrations.mentionProviders[0];
  if (!provider) throw new Error("project mention provider was not registered");
  return { bb, harness, provider, store };
}

describe("@project mention provider", () => {
  it("searches by prefix and name, case-insensitively", async () => {
    const { harness, provider, store } = setup();
    try {
      const tracked = store.tasks.createProject({
        name: "Tracked work",
        prefix: "TRK",
        color: "blue",
      });
      store.tasks.createProject({
        name: "Other project",
        prefix: "OPS",
        color: "red",
        status: "done",
      });

      expect(
        await provider.search({
          trigger: "@",
          query: "trk",
          projectId: null,
          threadId: null,
        }),
      ).toEqual([
        expect.objectContaining({
          id: tracked.id,
          title: "TRK · Tracked work",
          subtitle: "Todo",
        }),
      ]);

      expect(
        await provider.search({
          trigger: "@",
          query: "project",
          projectId: null,
          threadId: null,
        }),
      ).toEqual([
        expect.objectContaining({ title: "OPS · Other project", subtitle: "Done" }),
      ]);

      expect(
        await provider.search({
          trigger: "@",
          query: "",
          projectId: null,
          threadId: null,
        }),
      ).toHaveLength(2);
    } finally {
      await harness.dispose();
    }
  });

  it("resolves project context including tasks, attached threads, and the CLI action contract", async () => {
    const { harness, provider, store } = setup();
    try {
      const project = store.tasks.createProject({
        name: "Mentions",
        prefix: "MEN",
        color: "blue",
        description: "Where mentions live.",
        linkedBbProjectId: "proj_linked",
      });
      store.tasks.createTask({
        projectId: project.id,
        title: "Ship mention resolve",
        status: "todo",
      });
      store.tasks.upsertProjectThread({
        projectId: project.id,
        threadId: "thr_worker",
        title: "Mention worker",
      });

      const { context } = await provider.resolve(project.id);
      expect(context).toContain("# MEN · Mentions");
      expect(context).toContain("- Status: Todo");
      expect(context).toContain("- Linked bb project: proj_linked");
      expect(context).toContain("Where mentions live.");
      expect(context).toContain("- [ ] MEN-1 · Ship mention resolve");
      expect(context).toContain("thr_worker · Mention worker");
      expect(context).toContain(
        "first run: bb my-tasks project attach MEN (attaches THIS thread to the project)",
      );
    } finally {
      await harness.dispose();
    }
  });

  it("rejects an unknown project id", async () => {
    const { harness, provider } = setup();
    try {
      expect(() => provider.resolve("missing-project-id")).toThrow(
        "Project not found: missing-project-id",
      );
    } finally {
      await harness.dispose();
    }
  });
});
