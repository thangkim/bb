import { useEffect } from "react";
import {
  definePluginApp,
  experimental_usePluginId,
  useSidebarSplitLayout,
  type PluginSidebarSplitLayout,
  type PluginThreadAction,
  type PluginThreadActionRegistration,
} from "@get-bb/plugin-sdk/app";
import {
  CLOSE_BUTTON_SELECTOR,
  CLOSE_PANE_TITLE,
  FULL_SCREEN_TITLE,
  HIDE_CORE_CSS,
  MOVE_ACTIONS,
  arrangementButtonsForThread,
  decoratePluginMenuItems,
  moveViaArrangementMenu,
  toggleFullScreen,
  type PaneSide,
} from "./pane-arrangement";

let latestLayout: PluginSidebarSplitLayout | null = null;
let menuButton: HTMLButtonElement | null = null;

const PANE_ACTION_GROUP = "1_pane";

const MOVE_ICONS: Record<PaneSide, PluginThreadAction["icon"]> = {
  left: "ArrowLeft",
  right: "ArrowRight",
  top: "ArrowUp",
  bottom: "ArrowDown",
};

export function buttonForThread(
  threadId: string,
  selector?: string,
): HTMLButtonElement | null {
  const buttons = arrangementButtonsForThread(latestLayout, threadId, selector);
  const menuHeader = menuButton?.closest("header") ?? null;
  return (
    buttons.find((button) => button.closest("header") === menuHeader) ??
    buttons[0] ??
    null
  );
}

export function PaneArrangementMenuHost() {
  const layout = useSidebarSplitLayout();
  const pluginId = experimental_usePluginId();

  useEffect(() => {
    latestLayout = layout;
  }, [layout]);

  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.bbPlugin = pluginId;
    style.textContent = HIDE_CORE_CSS;
    document.head.append(style);
    const decorate = (root: Element) => {
      const result = decoratePluginMenuItems(root);
      if (result.found) menuButton = result.button;
    };
    decorate(document.body);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) decorate(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      style.remove();
      menuButton = null;
    };
  }, [pluginId]);

  return null;
}

function paneAction(
  id: string,
  title: string,
  icon: PluginThreadAction["icon"],
  run: (threadId: string) => void | Promise<void>,
  order: number,
): PluginThreadActionRegistration {
  return {
    id,
    title,
    icon,
    group: PANE_ACTION_GROUP,
    order,
    item: ({ thread }) => ({
      label: title,
      icon,
      run: () => run(thread.id),
    }),
  };
}

function paneActions(): PluginThreadActionRegistration[] {
  return [
    paneAction(
      "full-screen",
      FULL_SCREEN_TITLE,
      "Maximize2",
      (threadId) => {
        const button = buttonForThread(threadId);
        if (button !== null) toggleFullScreen(button);
      },
      0,
    ),
    ...MOVE_ACTIONS.map((action, index) =>
      paneAction(
        `move-${action.side}`,
        action.title,
        MOVE_ICONS[action.side],
        async (threadId) => {
          const button = buttonForThread(threadId);
          if (button !== null) await moveViaArrangementMenu(button, action.side);
        },
        index + 1,
      ),
    ),
    paneAction(
      "close-pane",
      CLOSE_PANE_TITLE,
      "CloseThreadPane",
      (threadId) => {
        buttonForThread(threadId, CLOSE_BUTTON_SELECTOR)?.click();
      },
      MOVE_ACTIONS.length + 1,
    ),
  ];
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "pane-arrangement-menu",
    component: PaneArrangementMenuHost,
  });

  for (const registration of paneActions()) {
    app.slots.experimental_threadAction(registration);
  }
});
