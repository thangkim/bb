import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createStore } from "../api";
import { readBrief } from "./brief";
import {
  READ_BRIEF_TOOL,
  registerProjectBrief,
  UPDATE_BRIEF_TOOL,
} from ".";

function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  const store = createStore(bb);
  registerProjectBrief(bb, store);
  const project = store.tasks.createProject({
    name: "Connect repo",
    prefix: "PRD",
    color: "blue",
    description: "## Problem\n\nRepos fail to import.",
  });
  const other = store.tasks.createProject({
    name: "Other",
    prefix: "OTH",
    color: "green",
  });
  return { harness, store, project, other };
}

function text(result: unknown): string {
  if (typeof result === "string") return result;
  const parts = (result as { content: { text: string }[] }).content;
  return parts.map((part) => part.text).join("");
}

describe("project brief tools", () => {
  it("updates the project linked through a task thread and publishes the change", async () => {
    const { harness, store, project } = setup();
    const task = store.tasks.createTask({ projectId: project.id, title: "T" });
    store.tasks.upsertTaskThread({
      taskId: task.id,
      threadId: "thr_work",
      presetName: "Default",
      title: "Work",
      liveStatus: "working",
    });

    const result = await harness.callAgentTool(
      UPDATE_BRIEF_TOOL,
      {
        solution: "Clone over HTTPS.",
        addDecisions: ["Tokens over SSH"],
        projectPriority: "high",
      },
      { threadId: "thr_work" },
    );

    expect(text(result)).toBe(
      "Updated the PRD brief:\n- Updated Solution\n- Added decision: Tokens over SSH\n- Set project priority to high",
    );
    const saved = store.tasks.getProject(project.id)!;
    expect(saved.priority).toBe("high");
    expect(readBrief(saved.description)).toEqual({
      sections: {
        problem: "Repos fail to import.",
        context: null,
        priority: null,
        solution: "Clone over HTTPS.",
      },
      decisions: ["Tokens over SSH"],
    });
    expect(harness.realtimeSignals).toContainEqual({
      channel: "projects:changed",
      payload: { projectId: project.id },
    });
  });

  it("asks for a project when the thread links to none or several", async () => {
    const { harness, store, project, other } = setup();
    const unlinked = await harness.callAgentTool(
      READ_BRIEF_TOOL,
      {},
      { threadId: "thr_none" },
    );
    expect(text(unlinked)).toMatch(/not linked to a My Tasks project/);

    for (const target of [project, other]) {
      store.tasks.upsertProjectThread({
        projectId: target.id,
        threadId: "thr_both",
        title: "Both",
      });
    }
    const ambiguous = await harness.callAgentTool(
      UPDATE_BRIEF_TOOL,
      { context: "x" },
      { threadId: "thr_both" },
    );
    expect(text(ambiguous)).toMatch(/several projects \(.*PRD.*\)/);
    expect(store.tasks.getProject(project.id)!.description).not.toContain("x");

    const explicit = await harness.callAgentTool(
      READ_BRIEF_TOOL,
      { project: "prd" },
      { threadId: "thr_both" },
    );
    expect(text(explicit)).toContain("# PRD: Connect repo");
    expect(text(explicit)).toContain("Repos fail to import.");
  });

  it("returns a tool error and saves nothing for a bad decision match", async () => {
    const { harness, store, project } = setup();
    const result = await harness.callAgentTool(UPDATE_BRIEF_TOOL, {
      project: "PRD",
      solution: "New",
      removeDecisions: ["missing"],
    });
    expect(result).toMatchObject({ isError: true });
    expect(store.tasks.getProject(project.id)!.description).toBe(
      "## Problem\n\nRepos fail to import.",
    );
  });

  it("tells only linked threads to ask before updating the brief", () => {
    const { harness, store, project } = setup();
    const provider = harness.registrations.instructionProvider!;
    expect(provider({ threadId: "thr_none", projectId: "proj_x" })).toBeNull();
    store.tasks.upsertProjectThread({
      projectId: project.id,
      threadId: "thr_linked",
      title: "Linked",
    });
    const instructions = provider({
      threadId: "thr_linked",
      projectId: "proj_x",
    });
    expect(instructions).toContain('PRD "Connect repo"');
    expect(instructions).toContain("only after the user agrees");
  });
});
