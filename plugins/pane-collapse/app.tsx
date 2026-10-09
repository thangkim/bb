import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  experimental_usePluginId,
  experimental_useSidebarThreads,
  useBbNavigate,
  useSidebarSplitLayout,
  type BbNavigate,
  type PluginSidebarSplitLayout,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PANE_SELECTOR,
  STRIP_ATTRIBUTE,
  canCollapse,
  collapsedLayoutCss,
  createCollapsedPaneStore,
  focusTargetAfterCollapse,
  newlyFocusedCollapsedPane,
  pruneCollapsed,
  withPane,
  withoutPane,
  type CollapsedPanes,
} from "./collapsed-panes";
import { readSplitDom, stampGridRoots } from "./split-dom";

export const collapsedPanes = createCollapsedPaneStore();

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

function expandPane(paneId: string): void {
  collapsedPanes.set(withoutPane(collapsedPanes.get(), paneId));
}

export function CollapsePaneButton(_props: PluginThreadHeaderActionProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [paneId, setPaneId] = useState<string | null>(null);
  const layout = useSidebarSplitLayout();
  const collapsed = useCollapsedPanes();
  const navigate = useBbNavigate();
  useLayoutEffect(() => {
    setPaneId(
      anchor.current?.closest<HTMLElement>(PANE_SELECTOR)?.dataset
        .splitPaneId ?? null,
    );
  }, [layout]);
  const available = paneId !== null && canCollapse(layout, collapsed, paneId);
  return (
    <>
      <span ref={anchor} hidden />
      {available ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Collapse pane"
          className="size-7 text-muted-foreground"
          onClick={() => collapsePane(layout, navigate, paneId)}
        >
          <Icon name="Minus" />
        </Button>
      ) : null}
    </>
  );
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
  return layout.panes.flatMap((pane) => {
    if (!collapsed.has(pane.paneId)) return [];
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
  title: string;
  vertical: boolean;
  needsInput: boolean;
  onExpand: () => void;
}

function CollapsedStrip({
  pluginId,
  title,
  vertical,
  needsInput,
  onExpand,
}: CollapsedStripProps) {
  return (
    <div
      data-bb-plugin={pluginId}
      {...{ [STRIP_ATTRIBUTE]: "" }}
      className="absolute inset-0 z-40 flex bg-background"
    >
      <button
        type="button"
        aria-label={`Expand ${title}`}
        title={title}
        onClick={onExpand}
        className={cn(
          "flex size-full cursor-pointer items-center gap-2 overflow-hidden text-muted-foreground hover:bg-state-hover hover:text-foreground",
          vertical ? "flex-col py-3" : "flex-row px-3",
        )}
      >
        <span className="relative flex shrink-0">
          <Icon name="MessageSquare" className="size-4" />
          {needsInput ? (
            <span className="absolute -right-1 -top-1 size-2 rounded-full bg-attention" />
          ) : null}
        </span>
        <span
          className={cn(
            "min-h-0 min-w-0 truncate text-xs",
            vertical && "[writing-mode:vertical-rl]",
          )}
        >
          {title}
        </span>
      </button>
    </div>
  );
}

export function CollapsedPaneStrips() {
  const layout = useSidebarSplitLayout();
  const navigate = useBbNavigate();
  const collapsed = useCollapsedPanes();
  const pluginId = experimental_usePluginId();
  const { threads } = experimental_useSidebarThreads();
  const focusedPaneId = useRef<string | null>(null);
  const [hosts, setHosts] = useState<StripHost[]>([]);

  useEffect(() => {
    latestLayout = layout;
    latestNavigate = navigate;
  }, [layout, navigate]);

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
      style.textContent = collapsedLayoutCss(dom.grids);
      observer.disconnect();
      for (const root of dom.roots) {
        observer.observe(root, { childList: true });
      }
      for (const cell of dom.cells) {
        observer.observe(cell, { attributes: true });
      }
    }
    apply();
    return () => {
      observer.disconnect();
      style.remove();
      stampGridRoots([]);
    };
  }, [collapsed, layout, pluginId]);

  useLayoutEffect(() => {
    setHosts(stripHosts(layout, collapsed));
  }, [layout, collapsed]);

  return (
    <>
      {hosts.map((host) => {
        const thread =
          host.threadId === null
            ? undefined
            : threads.find((candidate) => candidate.id === host.threadId);
        return createPortal(
          <CollapsedStrip
            pluginId={pluginId}
            title={thread?.displayTitle ?? "Thread"}
            vertical={host.vertical}
            needsInput={thread?.hasPendingInteraction ?? false}
            onExpand={() => expandPane(host.paneId)}
          />,
          host.element,
          host.paneId,
        );
      })}
    </>
  );
}

function focusedPaneId(): string | null {
  return latestLayout?.panes.find((pane) => pane.isFocused)?.paneId ?? null;
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "collapse-pane",
    title: "Collapse pane",
    component: CollapsePaneButton,
  });
  app.slots.experimental_appOverlay({
    id: "collapsed-strips",
    component: CollapsedPaneStrips,
  });

  app.commands.register({
    id: "collapse-focused",
    title: "Panes: collapse focused pane",
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
    id: "expand-all",
    title: "Panes: expand collapsed panes",
    isAvailable: () => collapsedPanes.get().size > 0,
    run: () => collapsedPanes.set(new Set()),
  });
});
