import { useEffect } from "react";
import {
  definePluginApp,
  experimental_usePluginId,
  useSidebarSplitLayout,
  type ExperimentalThreadMenuActionRegistration,
  type PluginSidebarSplitLayout,
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

const MOVE_ICONS: Record<
  PaneSide,
  NonNullable<ExperimentalThreadMenuActionRegistration["icon"]>
> = {
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

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "pane-arrangement-menu",
    component: PaneArrangementMenuHost,
  });

  app.slots.experimental_threadMenuAction({
    id: "full-screen",
    title: FULL_SCREEN_TITLE,
    icon: "Maximize2",
    run: ({ threadId }) => {
      const button = buttonForThread(threadId);
      if (button !== null) toggleFullScreen(button);
    },
  });

  for (const action of MOVE_ACTIONS) {
    app.slots.experimental_threadMenuAction({
      id: `move-${action.side}`,
      title: action.title,
      icon: MOVE_ICONS[action.side],
      run: async ({ threadId }) => {
        const button = buttonForThread(threadId);
        if (button !== null) await moveViaArrangementMenu(button, action.side);
      },
    });
  }

  app.slots.experimental_threadMenuAction({
    id: "close-pane",
    title: CLOSE_PANE_TITLE,
    icon: "CloseThreadPane",
    run: ({ threadId }) => {
      buttonForThread(threadId, CLOSE_BUTTON_SELECTOR)?.click();
    },
  });
});
