import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { mountSmartClose } from "./smart-close";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "smart-close",
    mount: ({ signal }) => mountSmartClose(signal),
  });
});
