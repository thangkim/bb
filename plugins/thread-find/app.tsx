import {
  definePluginApp,
  type PluginCommandContext,
} from "@get-bb/plugin-sdk/app";
import { ThreadFindOverlay } from "./ThreadFindOverlay.js";
import { openThreadFindForFocus } from "./thread-find-store.js";
import "./app.css";

export const findInThreadCommand = {
  id: "find",
  title: "Find in thread",
  isAvailable: ({ threadId }: PluginCommandContext) => threadId !== null,
  run: () => {
    openThreadFindForFocus(document);
  },
};

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "thread-find",
    component: ThreadFindOverlay,
  });
  app.commands.register(findInThreadCommand);
});
