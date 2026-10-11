import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  definePluginApp,
  useBbContext,
  useBbNavigate,
  useSdk,
  useSidebarSplitLayout,
  type BbNavigate,
  type PluginBrowserBbSdk,
  type PluginSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";
import {
  nextReopenTarget,
  recordClosedPanes,
  type ClosedPaneRecord,
  type Side,
} from "./closed-panes";
import { ComposeAnchor, openComposerBeside } from "./composer-beside";
import {
  advanceSplitTracker,
  copySplitTabs,
  seedSplitTracker,
  type SplitTrackerState,
} from "./split-tabs";

export const MAX_PANES = 8;
export const PANE_CAP_MESSAGE = "Can't split — 8 panes is the maximum.";
export const NOTHING_TO_REOPEN_MESSAGE = "No closed thread to reopen.";

type ThreadOpenSplit = NonNullable<
  Parameters<PluginBrowserBbSdk["threads"]["open"]>[0]["split"]
>;

export const REOPEN_SPLIT = {
  left: "left",
  right: "right",
  top: "top",
  bottom: "down",
} as const satisfies Record<Side, ThreadOpenSplit>;

interface Controller {
  sdk: PluginBrowserBbSdk;
  navigate: BbNavigate;
  layout: PluginSidebarSplitLayout | null;
  projectId: string | null;
  threadId: string | null;
}

let controller: Controller | null = null;
let observedLayout: PluginSidebarSplitLayout | null = null;
let closedHistory: readonly ClosedPaneRecord[] = [];

export function PaneSplitsController() {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const layout = useSidebarSplitLayout();
  const { projectId, threadId } = useBbContext();
  useEffect(() => {
    closedHistory = recordClosedPanes(closedHistory, observedLayout, layout);
    observedLayout = layout;
  }, [layout]);
  useEffect(() => {
    const current: Controller = { sdk, navigate, layout, projectId, threadId };
    controller = current;
    return () => {
      if (controller === current) controller = null;
    };
  }, [layout, navigate, projectId, sdk, threadId]);
  return <ComposeAnchor />;
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

function newThreadOnRight(): void {
  if (controller === null) return;
  openComposerBeside(controller.navigate, controller.projectId);
}

async function reopenClosedThread(): Promise<void> {
  if (controller === null) return;
  const { sdk, layout, threadId } = controller;
  const openThreadIds = new Set(
    layout?.panes.flatMap((pane) =>
      pane.threadId === null ? [] : [pane.threadId],
    ) ?? [],
  );
  if (threadId !== null) openThreadIds.add(threadId);
  const { target, history } = nextReopenTarget(closedHistory, openThreadIds);
  if (target === null) {
    closedHistory = history;
    toast(NOTHING_TO_REOPEN_MESSAGE);
    return;
  }
  if ((layout?.panes.length ?? 0) >= MAX_PANES) {
    toast(PANE_CAP_MESSAGE);
    return;
  }
  closedHistory = history;
  try {
    await sdk.threads.open({
      threadId: target.threadId,
      split: REOPEN_SPLIT[target.side],
      file: null,
    });
  } catch (error) {
    toast(
      `Couldn't reopen the thread: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
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

  app.commands.register({
    id: "split-right",
    title: "Panes: new thread on the right",
    defaultShortcut: { key: "d", alt: true },
    isAvailable: () => controller !== null,
    run: newThreadOnRight,
  });

  app.commands.register({
    id: "reopen-closed",
    title: "Panes: reopen closed thread",
    defaultShortcut: { key: "t", mod: true, alt: true },
    isAvailable: () => controller !== null,
    run: reopenClosedThread,
  });
});
