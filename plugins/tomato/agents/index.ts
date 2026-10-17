import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { TasksApiStore } from "../api";
import {
  autoTrackInstructions,
  candidateProjects,
  shouldAutoTrack,
  titleExamples,
  TRACK_THREAD_TOOL,
} from "../auto-track";
import {
  briefInstructions,
  linkedProjects,
  TOMATO_SKILL,
  READ_BRIEF_TOOL,
  UPDATE_BRIEF_TOOL,
} from "../brief";

export function registerAgentConfiguration(
  bb: BbPluginApi,
  store: TasksApiStore,
  autoTrackEnabled: () => boolean,
): void {
  bb.agents.configure((context) => {
    const brief = briefInstructions(linkedProjects(store, context.thread.id));
    if (brief !== null) {
      return {
        tools: [READ_BRIEF_TOOL, UPDATE_BRIEF_TOOL],
        skills: [TOMATO_SKILL],
        instructions: brief,
      };
    }
    if (autoTrackEnabled() && shouldAutoTrack(store, context)) {
      const instructions = autoTrackInstructions(
        candidateProjects(store, context.project.id),
        titleExamples(store),
      );
      if (instructions !== null) {
        return {
          tools: [TRACK_THREAD_TOOL],
          skills: [TOMATO_SKILL],
          instructions,
        };
      }
    }
    return { tools: [], skills: [TOMATO_SKILL] };
  });
}
