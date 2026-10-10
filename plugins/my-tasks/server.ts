import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { createStore, registerTasksApi } from "./api";
import { registerAttachments } from "./attachments";
import { registerProjectBrief } from "./brief";
import { registerTasksCli } from "./cli";
import { registerDelegation } from "./delegate";
import { registerLifecycle } from "./lifecycle";
import { registerMentions } from "./mentions";
import { registerProjectMentions } from "./mentions/project-mentions";
import {
  SHOW_COLLAPSED_PROJECT_THREADS_SETTING,
  SHOW_COMPLETED_TASKS_SETTING,
} from "./shared/settings";

const TASKS_PLUGIN_NAME = "My Tasks";
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

  bb.settings.define({
    [SHOW_COMPLETED_TASKS_SETTING]: {
      type: "boolean",
      label: "Show completed tasks",
      description:
        "Show done tasks in project task lists. When off, a task you check off stays visible until you collapse the project or leave the page.",
      default: false,
    },
    [SHOW_COLLAPSED_PROJECT_THREADS_SETTING]: {
      type: "boolean",
      label: "Show threads on collapsed projects",
      description:
        "List each project's threads in the project list even when its row is collapsed. When off, a project's threads appear only after you expand its row.",
      default: false,
    },
  });

  const store = createStore(bb);
  registerTasksApi(bb, store);
  registerAttachments(bb, store.tasks);
  registerTasksCli(bb, store, statusPayload());
  registerDelegation(bb, store);
  registerMentions(bb, store);
  registerProjectMentions(bb, store);
  registerProjectBrief(bb, store);
  await registerLifecycle(bb, store);

  bb.rpc.register(tasksRpcContract, {
    ping(): { ok: true; version: string } {
      return { ok: true, version: TASKS_PLUGIN_VERSION };
    },
  });
}
