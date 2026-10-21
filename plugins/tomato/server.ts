import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { registerAgentConfiguration } from "./agents";
import { createStore, registerTasksApi } from "./api";
import { registerAttachments } from "./attachments";
import { registerAutoTrack } from "./auto-track";
import { registerProjectBrief } from "./brief";
import { registerTasksCli } from "./cli";
import { registerDelegation } from "./delegate";
import { registerLifecycle } from "./lifecycle";
import { registerMentionAttach } from "./mention-attach";
import { registerMentions } from "./mentions";
import { registerProjectMentions } from "./mentions/project-mentions";
import {
  AUTO_TRACK_THREADS_SETTING,
  SHOW_COLLAPSED_PROJECT_THREADS_SETTING,
  SHOW_COMPLETED_TASKS_SETTING,
} from "./shared/settings";

const TASKS_PLUGIN_NAME = "Tomato";
export const TASKS_PLUGIN_VERSION = "0.1.0";

const tasksRpcContract = defineRpcContract({
  ping: {
    input: z.null(),
    output: z.object({ ok: z.literal(true), version: z.string() }),
  },
});

function statusPayload() {
  return { name: TASKS_PLUGIN_NAME, version: TASKS_PLUGIN_VERSION };
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info(`${TASKS_PLUGIN_NAME} ${TASKS_PLUGIN_VERSION} loaded`);

  const settings = bb.settings.define({
    [SHOW_COMPLETED_TASKS_SETTING]: {
      type: "boolean",
      label: "Show completed tasks",
      description:
        "Show done tasks in expanded project rows. When off, a task you check off stays visible until you collapse the project. The project page always shows done tasks.",
      default: false,
    },
    [SHOW_COLLAPSED_PROJECT_THREADS_SETTING]: {
      type: "boolean",
      label: "Show threads on collapsed projects",
      description:
        "List each project's threads in the project list even when its row is collapsed. When off, a project's threads appear only after you expand its row.",
      default: false,
    },
    [AUTO_TRACK_THREADS_SETTING]: {
      type: "boolean",
      label: "Track new threads as tasks",
      description:
        "When a new thread is not attached to any task or project, its agent files a concise task for the work in the best-fitting project and attaches the thread to it.",
      default: true,
    },
  });
  let autoTrackEnabled = (await settings.get())[AUTO_TRACK_THREADS_SETTING];
  settings.onChange((next) => {
    autoTrackEnabled = next[AUTO_TRACK_THREADS_SETTING];
  });

  const store = createStore(bb);
  registerTasksApi(bb, store);
  registerAttachments(bb, store.tasks);
  registerTasksCli(bb, store, statusPayload());
  registerDelegation(bb, store);
  registerMentions(bb, store);
  registerProjectMentions(bb, store);
  registerMentionAttach(bb, store);
  registerProjectBrief(bb, store);
  registerAutoTrack(bb, store);
  registerAgentConfiguration(bb, store, () => autoTrackEnabled);
  await registerLifecycle(bb, store);

  bb.rpc.register(tasksRpcContract, {
    ping(): { ok: true; version: string } {
      return { ok: true, version: TASKS_PLUGIN_VERSION };
    },
  });
}
