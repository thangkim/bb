import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  definePluginApp,
  experimental_useNewThreadHandler,
  experimental_useSplitPanes,
  useBbContext,
  useBbNavigate,
  useSdk,
  useSidebarSplitLayout,
  type BbNavigate,
  type ExperimentalNewThreadRequest,
  type ExperimentalSplitPaneNewThreadOptions,
  type ExperimentalSplitPaneOpenResult,
  type ExperimentalSplitPanes,
  type PluginSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";
import {
  nextReopenTarget,
  recordClosedPanes,
  type ClosedPaneRecord,
} from "./closed-panes";
import {
  advanceSplitTracker,
  copySplitTabs,
  seedSplitTracker,
  type SplitTrackerState,
} from "./split-tabs";

export const PANE_CAP_MESSAGE = "Can't split — 8 panes is the maximum.";
export const NOTHING_TO_REOPEN_MESSAGE = "No closed thread to reopen.";

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
  layout: PluginSidebarSplitLayout | null;
  threadId: string | null;
}

let controller: Controller | null = null;
let observedLayout: PluginSidebarSplitLayout | null = null;
let closedHistory: readonly ClosedPaneRecord[] = [];

export function PaneSplitsController() {
  const splitPanes = experimental_useSplitPanes();
  const navigate = useBbNavigate();
  const layout = useSidebarSplitLayout();
  const { threadId } = useBbContext();
  useEffect(() => {
    closedHistory = recordClosedPanes(closedHistory, observedLayout, layout);
    observedLayout = layout;
  }, [layout]);
  useEffect(() => {
    const current: Controller = { splitPanes, navigate, layout, threadId };
    controller = current;
    return () => {
      if (controller === current) controller = null;
    };
  }, [layout, navigate, splitPanes, threadId]);
  const handleNewThread = useCallback(
    (request: ExperimentalNewThreadRequest) =>
      openNewThreadBeside(splitPanes, request) !== "unavailable",
    [splitPanes],
  );
  experimental_useNewThreadHandler(handleNewThread);
  return null;
}

export function SplitTabsController() {
  const layout = useSidebarSplitLayout();
  const { threadId } = useBbContext();
  const sdk = useSdk();
  const tracker = useRef<SplitTrackerState | null>(null);
  useEffect(() => {
    if (tracker.current === null) {
      tracker.current = seedSplitTracker(layout, threadId);
      return;
    }
    const { state, created } = advanceSplitTracker(
      tracker.current,
      layout,
      threadId,
      Date.now(),
    );
    tracker.current = state;
    for (const creation of created) {
      copySplitTabs(sdk, creation).catch((error: unknown) => {
        console.warn(
          `Pane Splits could not copy side panel tabs to ${creation.threadId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
  }, [layout, threadId, sdk]);
  return null;
}

function splitNewThread(
  side: ExperimentalSplitPaneNewThreadOptions["side"],
): void {
  if (controller?.splitPanes.openNewThread({ side }) === "at-cap") {
    toast(PANE_CAP_MESSAGE);
  }
}

function openNewThreadBeside(
  splitPanes: ExperimentalSplitPanes,
  request: Partial<ExperimentalNewThreadRequest> = {},
): ExperimentalSplitPaneOpenResult {
  return splitPanes.openNewThread({
    ...request,
    side: "right",
    atPaneCap: "replace",
    reuseComposer: true,
  });
}

function runNewThreadBeside(): void {
  if (controller === null) return;
  if (openNewThreadBeside(controller.splitPanes) === "unavailable") {
    controller.navigate.toCompose({ focusPrompt: true });
  }
}

function reopenClosedThread(): void {
  if (controller === null) return;
  const openThreadIds = new Set(
    controller.layout?.panes.flatMap((pane) =>
      pane.threadId === null ? [] : [pane.threadId],
    ) ?? [],
  );
  if (controller.threadId !== null) openThreadIds.add(controller.threadId);
  const { target, history } = nextReopenTarget(closedHistory, openThreadIds);
  if (target === null) {
    closedHistory = history;
    toast(NOTHING_TO_REOPEN_MESSAGE);
    return;
  }
  const result = controller.splitPanes.openNewThread({
    side: target.side,
    focusPrompt: false,
  });
  if (result === "at-cap") {
    toast(PANE_CAP_MESSAGE);
    return;
  }
  closedHistory = history;
  controller.navigate.toThread(target.threadId);
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "controller",
    component: PaneSplitsController,
  });
  app.slots.experimental_appOverlay({
    id: "split-tabs",
    component: SplitTabsController,
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
    run: runNewThreadBeside,
  });

  app.commands.register({
    id: "reopen-closed",
    title: "Panes: reopen closed thread",
    defaultShortcut: { key: "t", mod: true, alt: true },
    isAvailable: () => controller !== null,
    run: reopenClosedThread,
  });
});
