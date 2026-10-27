import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { DEFAULT_DISPLAY_OPTION, DISPLAY_MODE_OPTIONS } from "./display-mode";

export default function paneCollapse(bb: BbPluginApi) {
  bb.settings.define({
    display: {
      type: "select",
      label: "Show minimized threads as",
      description:
        "Chips sit in the window title bar. Vertical strips are gathered on the left of the thread area, and horizontal strips in a bar across its top, with the most recently minimized thread leftmost.",
      options: [...DISPLAY_MODE_OPTIONS],
      default: DEFAULT_DISPLAY_OPTION,
    },
  });
}
