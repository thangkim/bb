import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ImageContextMenuOverlay } from "./ImageContextMenu";
import { mountImageCopy } from "./image-copy";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "image-copy",
    mount: ({ signal }) => mountImageCopy(signal),
  });
  app.slots.experimental_appOverlay({
    id: "image-context-menu",
    component: ImageContextMenuOverlay,
  });
});
