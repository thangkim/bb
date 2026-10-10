import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { NAVIGATION_SLOT_ID } from "./tabs";

export default function sidebarTabs(bb: BbPluginApi) {
  bb.onInstall(async () => {
    const { preferences } = await bb.sdk.system.uiPreferences.list();
    await bb.sdk.system.uiPreferences.set({
      key: "sidebar.navigationProvider",
      value: `${bb.pluginId}/${NAVIGATION_SLOT_ID}`,
      expectedRevision: preferences["sidebar.navigationProvider"].revision,
    });
  });
}
