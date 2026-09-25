import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { mountImageCopy } from "./image-copy";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "image-copy",
    mount: ({ signal }) => mountImageCopy(signal),
  });
});
