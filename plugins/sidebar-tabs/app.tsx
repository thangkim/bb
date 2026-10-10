import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  definePluginApp,
  experimental_SidebarNavigationIcon as NavigationIcon,
  experimental_usePluginId,
  experimental_useSidebarNavigation,
  experimental_useSidebarNavigationSplit,
  type ExperimentalSidebarNavigationItem,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  EXPANDED_ATTRIBUTE,
  NAVIGATION_REGION_SELECTOR,
  NAVIGATION_SLOT_ID,
  PANEL_ATTRIBUTE,
  PANELS_CHANGED_EVENT,
  SIDEBAR_TABS,
  adjacentTab,
  createTabStore,
  expandedRegionCss,
  type SidebarTab,
} from "./tabs";

export const tabStore = createTabStore();

const TAB_LABELS: Record<SidebarTab, string> = {
  projects: "Projects",
  threads: "Threads",
  more: "More",
};

const TAB_ICONS: Record<SidebarTab, string> = {
  projects: "ListTodo",
  threads: "MessageSquare",
  more: "MoreHorizontal",
};

const ROW_CLASS =
  "flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 disabled:cursor-default disabled:opacity-70 max-md:pointer-coarse:h-10 max-md:pointer-coarse:text-base";

function useActiveTab(): SidebarTab {
  return useSyncExternalStore(tabStore.subscribe, tabStore.get, tabStore.get);
}

function useExpandedRegion(
  rootRef: RefObject<HTMLElement | null>,
  expanded: boolean,
): void {
  const pluginId = experimental_usePluginId();
  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.bbPlugin = pluginId;
    style.textContent = expandedRegionCss();
    document.head.append(style);
    return () => style.remove();
  }, [pluginId]);
  useLayoutEffect(() => {
    if (!expanded) return;
    const region = rootRef.current?.closest<HTMLElement>(
      NAVIGATION_REGION_SELECTOR,
    );
    if (region === null || region === undefined) return;
    region.setAttribute(EXPANDED_ATTRIBUTE, "");
    return () => region.removeAttribute(EXPANDED_ATTRIBUTE);
  }, [expanded, rootRef]);
}

function TabBar({ active, baseId }: { active: SidebarTab; baseId: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const select = (tab: SidebarTab, focus: boolean) => {
    tabStore.set(tab);
    if (focus) {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-sidebar-tab="${tab}"]`)
        ?.focus();
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target =
      event.key === "ArrowLeft"
        ? adjacentTab(active, -1)
        : event.key === "ArrowRight"
          ? adjacentTab(active, 1)
          : event.key === "Home"
            ? SIDEBAR_TABS[0]
            : event.key === "End"
              ? SIDEBAR_TABS[SIDEBAR_TABS.length - 1]
              : null;
    if (target === null || target === undefined) return;
    event.preventDefault();
    select(target, true);
  };
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Sidebar"
      className="flex shrink-0 items-center gap-1 px-2 pt-2 pb-1.5"
      onKeyDown={onKeyDown}
    >
      {SIDEBAR_TABS.map((tab) => {
        const selected = tab === active;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab}`}
            data-sidebar-tab={tab}
            aria-selected={selected}
            aria-controls={
              tab === "threads" ? undefined : `${baseId}-panel-${tab}`
            }
            aria-label={TAB_LABELS[tab]}
            title={TAB_LABELS[tab]}
            tabIndex={selected ? 0 : -1}
            onClick={() => select(tab, false)}
            className={cn(
              "flex h-7 w-8 flex-none cursor-pointer items-center justify-center rounded-md text-sm text-muted-foreground outline-none ring-sidebar-ring transition-colors hover:bg-state-hover hover:text-foreground focus-visible:ring-2 max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-10",
              selected &&
                "bg-sidebar-accent font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
            )}
          >
            <Icon
              name={TAB_ICONS[tab]}
              className="size-4 shrink-0"
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}

function ProjectsPanel() {
  useLayoutEffect(() => {
    window.dispatchEvent(new Event(PANELS_CHANGED_EVENT));
    return () => {
      queueMicrotask(() =>
        window.dispatchEvent(new Event(PANELS_CHANGED_EVENT)),
      );
    };
  }, []);
  return (
    <>
      <div
        {...{ [PANEL_ATTRIBUTE]: "projects" }}
        className="peer flex min-h-0 flex-1 flex-col empty:hidden"
      />
      <p className="hidden px-3 py-4 text-xs text-muted-foreground peer-empty:block">
        Enable the My Tasks plugin to see your projects here.
      </p>
    </>
  );
}

function NavigationRow({ item }: { item: ExperimentalSidebarNavigationItem }) {
  const { activeItemId, actions, isShortcutModifierHeld } =
    experimental_useSidebarNavigation();
  const split = experimental_useSidebarNavigationSplit(item.id);
  const isActive =
    item.id === activeItemId && item.action.kind !== "new-thread";
  const shortcut = isShortcutModifierHeld ? item.shortcut : null;
  const Accessory = shortcut === null ? item.experimental_Accessory : null;
  return (
    <div className="relative" data-sidebar-navigation-item={item.id}>
      <button
        type="button"
        className={cn(
          ROW_CLASS,
          Accessory !== null && "pr-18",
          isActive && "bg-sidebar-accent text-sidebar-foreground",
          item.isLoading && "text-sidebar-foreground/55",
        )}
        disabled={item.isDisabled}
        aria-busy={item.isLoading || undefined}
        aria-current={isActive ? "page" : undefined}
        aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
        aria-label={
          item.shortcut ? `${item.label} (${item.shortcut.label})` : undefined
        }
        {...split.splitProps}
        onClick={(event) =>
          actions.activate(item.id, {
            openInSplit: event.metaKey || event.ctrlKey,
          })
        }
      >
        <NavigationIcon icon={item.icon} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {shortcut ? (
          <kbd className="shrink-0 rounded border border-border-hairline px-1 font-sans text-xs text-muted-foreground">
            {shortcut.label}
          </kbd>
        ) : null}
      </button>
      {Accessory !== null ? (
        <span className="pointer-events-none absolute right-2 top-1/2 block max-h-5 max-w-16 -translate-y-1/2 overflow-hidden text-xs leading-5 text-ellipsis whitespace-nowrap">
          <Accessory />
        </span>
      ) : null}
    </div>
  );
}

export function NavigationList() {
  const { items, actions } = experimental_useSidebarNavigation();
  const visible = items.filter((item) => item.isVisible);
  const hidden = items.filter((item) => !item.isVisible);
  return (
    <div
      className="space-y-0.5 px-2 py-1"
      data-testid="sidebar-tabs-navigation"
    >
      {visible.map((item) => (
        <NavigationRow key={item.id} item={item} />
      ))}
      {hidden.length > 0 ? (
        <>
          <div className="px-2 pt-3 pb-1 text-xs text-muted-foreground">
            Hidden
          </div>
          {hidden.map((item) => (
            <NavigationRow key={item.id} item={item} />
          ))}
        </>
      ) : null}
      <div
        aria-hidden
        className="mx-2 my-1.5 border-t border-sidebar-border/25"
      />
      <button
        type="button"
        className={cn(ROW_CLASS, "text-muted-foreground")}
        onClick={() => actions.openCustomize()}
      >
        <Icon name="Settings" className="size-4" aria-hidden />
        <span className="min-w-0 flex-1 truncate">Customize sidebar</span>
      </button>
    </div>
  );
}

export function SidebarTabs(_props: ExperimentalSidebarNavigationProps) {
  const active = useActiveTab();
  const rootRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const expanded = active !== "threads";
  useExpandedRegion(rootRef, expanded);
  return (
    <div
      ref={rootRef}
      data-sidebar-tabs={active}
      className={cn("flex flex-col", expanded && "min-h-0 flex-1")}
    >
      <TabBar active={active} baseId={baseId} />
      <div
        aria-hidden
        className="mx-2 shrink-0 border-t border-sidebar-border/25"
      />
      <div
        role="tabpanel"
        id={`${baseId}-panel-projects`}
        aria-labelledby={`${baseId}-tab-projects`}
        className={cn(
          "min-h-0 flex-1 flex-col",
          active === "projects" ? "flex" : "hidden",
        )}
      >
        {active === "projects" ? <ProjectsPanel /> : null}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-more`}
        aria-labelledby={`${baseId}-tab-more`}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          active === "more" ? "block" : "hidden",
        )}
      >
        {active === "more" ? <NavigationList /> : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_sidebarNavigation({
    id: NAVIGATION_SLOT_ID,
    title: "Sidebar tabs",
    description:
      "Projects, Threads, and More tabs. Navigation rows move into More.",
    component: SidebarTabs,
  });
  for (const tab of SIDEBAR_TABS) {
    app.commands.register({
      id: `show-${tab}`,
      title: `Sidebar: show ${TAB_LABELS[tab]} tab`,
      run: () => tabStore.set(tab),
    });
  }
});
