import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  experimental_THREAD_ACTION_GROUPS,
  experimental_usePluginId,
  experimental_useSidebarThreads,
  useBbNavigate,
  useSidebarSplitLayout,
  type BbNavigate,
  type PluginSidebarSplitLayout,
  type PluginThreadActionItemInput,
  type PluginThreadAction,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PANE_SELECTOR,
  STRIP_ATTRIBUTE,
  canCollapse,
  collapsedLayoutCss,
  createBrowserCollapsedPanesStorage,
  createCollapsedPaneStore,
  focusTargetAfterCollapse,
  latestCollapsed,
  minimizedThreadIds,
  newlyFocusedCollapsedPane,
  pruneCollapsed,
  withPane,
  withoutPane,
  type CollapsedPaneDisplay,
  type CollapsedPanes,
} from "./collapsed-panes";
import { usePaneLinkedWork } from "./linked-work";
import { AttentionDot, MinimizedChip, paneLabel } from "./chip";
import { installBridgedDividerDrag } from "./bridged-divider";
import { readSplitDom, stampGridRoots } from "./split-dom";

export const collapsedPanes = createCollapsedPaneStore(
  createBrowserCollapsedPanesStorage(),
);
const minimizedThreadStore = createCollapsedPaneStore();

let latestLayout: PluginSidebarSplitLayout | null = null;
let latestNavigate: BbNavigate | null = null;

function useCollapsedPanes(): CollapsedPanes {
  return useSyncExternalStore(
    collapsedPanes.subscribe,
    collapsedPanes.get,
    collapsedPanes.get,
  );
}

function collapsePane(
  layout: PluginSidebarSplitLayout | null,
  navigate: BbNavigate | null,
  paneId: string,
): boolean {
  const collapsed = collapsedPanes.get();
  if (layout === null || !canCollapse(layout, collapsed, paneId)) return false;
  const target = focusTargetAfterCollapse(layout, collapsed, paneId);
  collapsedPanes.set(withPane(collapsed, paneId));
  if (target !== null) navigate?.toThread(target);
  return true;
}

function restorePane(
  paneId: string,
  threadId: string | null,
  navigate: BbNavigate | null,
): void {
  collapsedPanes.set(withoutPane(collapsedPanes.get(), paneId));
  if (threadId !== null) navigate?.toThread(threadId);
}

export interface MinimizeActionData {
  layout: PluginSidebarSplitLayout | null;
  collapsed: CollapsedPanes;
}

export function useMinimizeActionData(): MinimizeActionData {
  const layout = useSidebarSplitLayout();
  const collapsed = useCollapsedPanes();
  return useMemo(() => ({ layout, collapsed }), [layout, collapsed]);
}

export function minimizePaneAction({
  thread,
  data,
  navigate,
}: PluginThreadActionItemInput<MinimizeActionData>): PluginThreadAction | null {
  const pane = data.layout?.panes.find(
    (candidate) => candidate.threadId === thread.id,
  );
  if (
    pane === undefined ||
    !canCollapse(data.layout, data.collapsed, pane.paneId)
  ) {
    return null;
  }
  return {
    label: "Minimize pane",
    icon: "Minus",
    run: () => {
      collapsePane(data.layout, navigate, pane.paneId);
    },
  };
}

export const TITLE_BAR_SELECTOR = '[data-testid="app-window-title-bar"]';
export const TRAY_ATTRIBUTE = "data-pane-collapse-tray";

function useTitleBar(active: boolean): HTMLElement | null {
  const [titleBar, setTitleBar] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!active) {
      setTitleBar(null);
      return;
    }
    const update = () => {
      const next = document.querySelector<HTMLElement>(TITLE_BAR_SELECTOR);
      setTitleBar((current) => (current === next ? current : next));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [active]);
  return titleBar;
}

function useTitleBarTray(
  titleBar: HTMLElement | null,
  pluginId: string,
): HTMLElement | null {
  const [tray, setTray] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (titleBar === null) {
      setTray(null);
      return;
    }
    const element = document.createElement("div");
    element.dataset.bbPlugin = pluginId;
    element.setAttribute(TRAY_ATTRIBUTE, "");
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", "Minimized threads");
    element.className =
      "flex min-w-0 flex-1 items-center gap-1 overflow-hidden px-2 [transform:translateY(var(--bb-macos-chrome-control-y,2px))]";
    titleBar.insertBefore(element, titleBar.children[1] ?? null);
    setTray(element);
    return () => element.remove();
  }, [titleBar, pluginId]);
  return tray;
}

interface StripHost {
  paneId: string;
  threadId: string | null;
  element: HTMLElement;
  vertical: boolean;
}

function stripHosts(
  layout: PluginSidebarSplitLayout | null,
  collapsed: CollapsedPanes,
): StripHost[] {
  if (layout === null) return [];
  return [...collapsed].flatMap((paneId) => {
    const pane = layout.panes.find((candidate) => candidate.paneId === paneId);
    if (pane === undefined) return [];
    const element = [
      ...document.querySelectorAll<HTMLElement>(PANE_SELECTOR),
    ].find((candidate) => candidate.dataset.splitPaneId === pane.paneId);
    if (element === undefined) return [];
    const container = element.parentElement?.parentElement;
    const vertical =
      container === null ||
      container === undefined ||
      !getComputedStyle(container).flexDirection.startsWith("column");
    return [
      { paneId: pane.paneId, threadId: pane.threadId, element, vertical },
    ];
  });
}

interface CollapsedStripProps {
  pluginId: string;
  pane: HTMLElement;
  title: string;
  vertical: boolean;
  needsInput: boolean;
  finishedUnread: boolean;
  onRestore: () => void;
}

const UPRIGHT_VERTICAL_TEXT_CLASS =
  "[writing-mode:vertical-rl] [text-orientation:upright]";

function CollapsedStrip({
  pluginId,
  pane,
  title,
  vertical,
  needsInput,
  finishedUnread,
  onRestore,
}: CollapsedStripProps) {
  const work = usePaneLinkedWork(pane);
  const label = paneLabel(title, work);
  return (
    <div
      data-bb-plugin={pluginId}
      {...{ [STRIP_ATTRIBUTE]: "" }}
      className="absolute inset-0 z-40 flex bg-background"
    >
      <button
        type="button"
        aria-label={`Restore ${label}${finishedUnread ? ", new reply" : ""}`}
        title={label}
        onClick={onRestore}
        className={cn(
          "flex size-full cursor-pointer items-center gap-2 overflow-hidden text-muted-foreground hover:bg-state-hover hover:text-foreground",
          vertical ? "flex-col py-3" : "flex-row px-3",
        )}
      >
        <span className="relative flex shrink-0">
          <Icon
            name="MessageSquare"
            className={cn("size-4", finishedUnread && "text-timeline-accent")}
          />
          {needsInput ? <AttentionDot /> : null}
        </span>
        <span
          className={cn(
            "min-h-0 min-w-0 truncate text-xs",
            vertical && UPRIGHT_VERTICAL_TEXT_CLASS,
          )}
        >
          {title}
        </span>
        {work === null ? null : (
          <span
            aria-hidden
            className={cn(
              "flex min-h-0 min-w-0 items-center gap-1.5 text-xs",
              vertical && "mt-2 flex-col",
            )}
          >
            {work.kind === "project" && work.color !== null ? (
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: work.color }}
              />
            ) : null}
            <span
              className={cn(
                "min-h-0 min-w-0 truncate",
                work.kind === "task" && "text-timeline-accent",
                vertical && UPRIGHT_VERTICAL_TEXT_CLASS,
              )}
            >
              {work.label}
            </span>
          </span>
        )}
      </button>
    </div>
  );
}

export function CollapsedPaneOverlay() {
  const layout = useSidebarSplitLayout();
  const navigate = useBbNavigate();
  const collapsed = useCollapsedPanes();
  const pluginId = experimental_usePluginId();
  const { threads } = experimental_useSidebarThreads();
  const focusedPaneId = useRef<string | null>(null);
  const [hosts, setHosts] = useState<StripHost[]>([]);
  const titleBar = useTitleBar(collapsed.size > 0);
  const tray = useTitleBarTray(titleBar, pluginId);
  const display: CollapsedPaneDisplay = tray === null ? "strip" : "hidden";

  useEffect(() => {
    latestLayout = layout;
    latestNavigate = navigate;
  }, [layout, navigate]);

  useEffect(() => {
    minimizedThreadStore.set(minimizedThreadIds(layout, collapsed));
  }, [layout, collapsed]);

  useEffect(() => {
    const next = newlyFocusedCollapsedPane(
      focusedPaneId.current,
      layout,
      collapsedPanes.get(),
    );
    focusedPaneId.current = next.focusedPaneId;
    let state = pruneCollapsed(collapsedPanes.get(), layout);
    if (next.expand !== null) state = withoutPane(state, next.expand);
    collapsedPanes.set(state);
  }, [layout]);

  useLayoutEffect(() => {
    if (collapsed.size === 0) return;
    const style = document.createElement("style");
    style.dataset.bbPlugin = pluginId;
    document.head.append(style);
    const observer = new MutationObserver(apply);
    function apply() {
      style.textContent = "";
      const dom = readSplitDom(collapsed);
      stampGridRoots(dom.roots);
      style.textContent = collapsedLayoutCss(dom.grids, display);
      observer.disconnect();
      for (const root of dom.roots) {
        observer.observe(root, { childList: true });
      }
      for (const cell of dom.cells) {
        observer.observe(cell, { attributes: true });
      }
    }
    apply();
    const uninstallDrag = installBridgedDividerDrag(document);
    return () => {
      uninstallDrag();
      observer.disconnect();
      style.remove();
      stampGridRoots([]);
    };
  }, [collapsed, display, layout, pluginId]);

  useLayoutEffect(() => {
    setHosts(stripHosts(layout, collapsed));
  }, [layout, collapsed]);

  const panes = hosts.map((host) => {
    const thread =
      host.threadId === null
        ? undefined
        : threads.find((candidate) => candidate.id === host.threadId);
    return {
      host,
      title: thread?.displayTitle ?? "Thread",
      needsInput: thread?.hasPendingInteraction ?? false,
      finishedUnread: thread?.indicator === "unread-success",
      updatedAt: thread?.updatedAt ?? 0,
      onRestore: () => restorePane(host.paneId, host.threadId, navigate),
    };
  });

  if (tray !== null) {
    return createPortal(
      [...panes]
        .reverse()
        .map(
          ({
            host,
            title,
            needsInput,
            finishedUnread,
            updatedAt,
            onRestore,
          }) => (
            <MinimizedChip
              key={host.paneId}
              pane={host.element}
              threadId={host.threadId}
              finishedUnread={finishedUnread}
              updatedAt={updatedAt}
              title={title}
              needsInput={needsInput}
              onRestore={onRestore}
            />
          ),
        ),
      tray,
    );
  }

  return (
    <>
      {panes.map(({ host, title, needsInput, finishedUnread, onRestore }) =>
        createPortal(
          <CollapsedStrip
            pluginId={pluginId}
            pane={host.element}
            title={title}
            vertical={host.vertical}
            needsInput={needsInput}
            finishedUnread={finishedUnread}
            onRestore={onRestore}
          />,
          host.element,
          host.paneId,
        ),
      )}
    </>
  );
}

function focusedPaneId(): string | null {
  return latestLayout?.panes.find((pane) => pane.isFocused)?.paneId ?? null;
}

export default definePluginApp((app) => {
  app.slots.experimental_threadAction<MinimizeActionData>({
    id: "minimize-pane",
    title: "Minimize pane",
    icon: "Minus",
    group: experimental_THREAD_ACTION_GROUPS.open,
    useData: useMinimizeActionData,
    item: minimizePaneAction,
  });
  app.slots.experimental_appOverlay({
    id: "collapsed-strips",
    component: CollapsedPaneOverlay,
  });
  app.contentScripts.register({
    id: "minimized-threads",
    mount: (context) => {
      const publish = () => {
        context.experimental_setMinimizedThreadIds?.(
          minimizedThreadStore.get(),
        );
      };
      publish();
      return minimizedThreadStore.subscribe(publish);
    },
  });

  app.commands.register({
    id: "collapse-focused",
    title: "Panes: minimize focused pane",
    defaultShortcut: { key: "z", alt: true, shift: true },
    isAvailable: () => {
      const paneId = focusedPaneId();
      return (
        paneId !== null &&
        canCollapse(latestLayout, collapsedPanes.get(), paneId)
      );
    },
    run: () => {
      const paneId = focusedPaneId();
      if (paneId !== null) collapsePane(latestLayout, latestNavigate, paneId);
    },
  });

  app.commands.register({
    id: "restore-latest",
    title: "Panes: restore most recently minimized pane",
    defaultShortcut: { key: "z", meta: true, control: true },
    isAvailable: () => latestCollapsed(collapsedPanes.get()) !== null,
    run: () => {
      const paneId = latestCollapsed(collapsedPanes.get());
      if (paneId === null) return;
      const threadId =
        latestLayout?.panes.find((pane) => pane.paneId === paneId)?.threadId ??
        null;
      restorePane(paneId, threadId, latestNavigate);
    },
  });

  app.commands.register({
    id: "expand-all",
    title: "Panes: restore minimized panes",
    isAvailable: () => collapsedPanes.get().size > 0,
    run: () => collapsedPanes.set(new Set()),
  });
});
