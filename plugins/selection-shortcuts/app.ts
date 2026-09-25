import { definePluginApp } from "@get-bb/plugin-sdk/app";
import "./app.css";
import { mountSelectionShortcuts } from "./selection-shortcuts";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "selection-shortcuts",
    mount: ({ signal }) => mountSelectionShortcuts(signal),
  });
});
