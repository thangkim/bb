import { useEffect } from "react";
import { toast } from "sonner";
import {
  definePluginApp,
  experimental_useSplitPanes,
  useBbNavigate,
  type BbNavigate,
  type ExperimentalSplitPaneNewThreadOptions,
  type ExperimentalSplitPanes,
} from "@get-bb/plugin-sdk/app";

export const PANE_CAP_MESSAGE = "Can't split — 8 panes is the maximum.";

export const SPLIT_COMMANDS = [
  { id: "split-left", side: "left", key: "a", direction: "left" },
  { id: "split-right", side: "right", key: "d", direction: "right" },
  { id: "split-up", side: "top", key: "w", direction: "up" },
  { id: "split-down", side: "bottom", key: "s", direction: "down" },
] as const satisfies readonly {
  id: string;
  side: ExperimentalSplitPaneNewThreadOptions["side"];
  key: string;
  direction: string;
}[];

interface Controller {
  splitPanes: ExperimentalSplitPanes;
  navigate: BbNavigate;
}

let controller: Controller | null = null;

export function PaneSplitsController() {
  const splitPanes = experimental_useSplitPanes();
  const navigate = useBbNavigate();
  useEffect(() => {
    const current: Controller = { splitPanes, navigate };
    controller = current;
    return () => {
      if (controller === current) controller = null;
    };
  }, [navigate, splitPanes]);
  return null;
}

function splitNewThread(
  side: ExperimentalSplitPaneNewThreadOptions["side"],
): void {
  if (controller?.splitPanes.openNewThread({ side }) === "at-cap") {
    toast(PANE_CAP_MESSAGE);
  }
}

function openNewThreadBeside(): void {
  if (controller === null) return;
  const result = controller.splitPanes.openNewThread({
    side: "right",
    atPaneCap: "replace",
  });
  if (result === "unavailable") {
    controller.navigate.toCompose({ focusPrompt: true });
  }
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "controller",
    component: PaneSplitsController,
  });

  for (const command of SPLIT_COMMANDS) {
    app.commands.register({
      id: command.id,
      title: `Panes: split new thread ${command.direction}`,
      defaultShortcut: { key: command.key, alt: true },
      isAvailable: () => controller?.splitPanes.isAvailable === true,
      run: () => splitNewThread(command.side),
    });
  }

  app.commands.register({
    id: "new-thread-beside",
    title: "Panes: new thread beside the focused pane",
    isAvailable: () => controller !== null,
    run: openNewThreadBeside,
  });
});
