import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useBbContext, useSdk } from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  THREAD_FIND_IGNORED_SELECTOR,
  THREAD_FIND_SEARCH_ROOT_SELECTOR,
  findVerticalScroller,
  isFindAgainShortcut,
  isMacPlatform,
  isRangeBelowViewTop,
  lastRowPositionAboveViewBottom,
  listTopLevelRows,
  resolveFindShortcutTarget,
  revealRange,
  rowIdOf,
  scrollUntilRowMounted,
  topLevelRowOf,
} from "./thread-find-dom.js";
import {
  loadThreadTextIndex,
  refreshLatestThreadText,
  resolveRowPosition,
  type ThreadTextIndex,
} from "./thread-find-index.js";
import {
  clearThreadFindHighlights,
  findTextMatches,
  paintThreadFindHighlights,
} from "./thread-find-matches.js";
import {
  anchorOf,
  collectThreadFindMatches,
  firstMatchAtOrBelowViewTop,
  indexMatchesMountedRows,
  positionMountedRows,
  resolveAnchoredIndex,
  type MountedMatchRow,
  type ObservedRowMatches,
  type ThreadFindAnchor,
  type ThreadFindMatch,
} from "./thread-find-results.js";
import {
  closeThreadFind,
  getThreadFindSession,
  openThreadFind,
  refocusThreadFind,
  subscribeThreadFind,
  type ThreadFindSession,
} from "./thread-find-store.js";

export const THREAD_FIND_RESEARCH_DELAY_MS = 150;
export const THREAD_FIND_INDEX_REFRESH_INTERVAL_MS = 5_000;
const BAR_TOP_INSET_PX = 8;
const BAR_RIGHT_INSET_PX = 12;

interface BarPosition {
  top: number;
  right: number;
}

function isIgnoredElement(element: Element): boolean {
  return element.closest(THREAD_FIND_IGNORED_SELECTOR) !== null;
}

function isIgnoredMutation(record: MutationRecord): boolean {
  const target =
    record.target instanceof Element
      ? record.target
      : record.target.parentElement;
  return target === null || isIgnoredElement(target);
}

function formatMatchStatus(query: string, count: number, active: number) {
  if (query.length === 0) return "";
  if (count === 0) return "No results";
  return `${active + 1}/${count}`;
}

function useFindShortcut(): void {
  useEffect(() => {
    const isMac = isMacPlatform(navigator.platform);
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = resolveFindShortcutTarget(event, document, isMac);
      if (target === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (target.kind === "find-bar") {
        refocusThreadFind();
        return;
      }
      openThreadFind(target.threadWindow, document.activeElement);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);
}

function isSideSurface(threadWindow: HTMLElement): boolean {
  return threadWindow.hasAttribute("data-surface-tone");
}

interface ThreadTextIndexState {
  index: ThreadTextIndex | null;
  requestRefresh: () => void;
}

function useThreadTextIndex(threadWindow: HTMLElement): ThreadTextIndexState {
  const sdk = useSdk();
  const { threadId } = useBbContext();
  const threadsRef = useRef(sdk.threads);
  const [loaded, setLoaded] = useState<{
    threadId: string;
    index: ThreadTextIndex;
  } | null>(null);
  const indexRef = useRef<ThreadTextIndex | null>(null);
  const lastRefreshRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const targetThreadId = isSideSurface(threadWindow) ? null : threadId;
  const index =
    loaded !== null && loaded.threadId === targetThreadId ? loaded.index : null;

  const publish = useCallback((forThread: string, next: ThreadTextIndex) => {
    indexRef.current = next;
    setLoaded({ threadId: forThread, index: next });
  }, []);

  useEffect(() => {
    threadsRef.current = sdk.threads;
  });

  useEffect(() => {
    indexRef.current = null;
    if (targetThreadId === null) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    lastRefreshRef.current = Date.now();
    loadThreadTextIndex(threadsRef.current, targetThreadId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) publish(targetThreadId, next);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [publish, targetThreadId]);

  const requestRefresh = useCallback(() => {
    const previous = indexRef.current;
    const signal = controllerRef.current?.signal;
    if (targetThreadId === null || previous === null || signal === undefined) {
      return;
    }
    const now = Date.now();
    if (now - lastRefreshRef.current < THREAD_FIND_INDEX_REFRESH_INTERVAL_MS) {
      return;
    }
    lastRefreshRef.current = now;
    refreshLatestThreadText(
      threadsRef.current,
      targetThreadId,
      previous,
      signal,
    )
      .then((refreshed) => {
        if (!signal.aborted) publish(targetThreadId, refreshed);
      })
      .catch(() => {});
  }, [publish, targetThreadId]);

  return { index, requestRefresh };
}

function useBarPosition(threadWindow: HTMLElement): BarPosition | null {
  const [position, setPosition] = useState<BarPosition | null>(null);
  useLayoutEffect(() => {
    const update = () => {
      if (!threadWindow.isConnected) {
        closeThreadFind();
        return;
      }
      const rect = threadWindow.getBoundingClientRect();
      const top = rect.top + BAR_TOP_INSET_PX;
      const right = window.innerWidth - rect.right + BAR_RIGHT_INSET_PX;
      setPosition((previous) =>
        previous?.top === top && previous.right === right
          ? previous
          : { top, right },
      );
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(threadWindow);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [threadWindow]);
  return position;
}

interface ThreadFindBarProps {
  session: ThreadFindSession;
  query: string;
  onQueryChange: (query: string) => void;
}

interface SearchSnapshot {
  index: ThreadTextIndex | null;
  list: Element | null;
}

function ThreadFindBar({ session, query, onQueryChange }: ThreadFindBarProps) {
  const { threadWindow } = session;
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRequestRef = useRef<"first-visible" | "active" | null>(null);
  const anchorRef = useRef<ThreadFindAnchor | null>(null);
  const observedRef = useRef(new Map<string, ObservedRowMatches>());
  const snapshotRef = useRef<SearchSnapshot>({ index: null, list: null });
  const mountRef = useRef<{ rowId: string; controller: AbortController }>(null);
  const [matches, setMatches] = useState<readonly ThreadFindMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const position = useBarPosition(threadWindow);
  const { index, requestRefresh } = useThreadTextIndex(threadWindow);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [session.request]);

  const runSearch = useCallback(() => {
    if (!threadWindow.isConnected) {
      closeThreadFind();
      return;
    }
    const list = threadWindow.querySelector(THREAD_FIND_SEARCH_ROOT_SELECTOR);
    const ranges =
      list === null ? [] : findTextMatches(list, query, isIgnoredElement);
    const rows = list === null ? [] : listTopLevelRows(list);
    const rowIds = rows.map(rowIdOf);
    const usableIndex =
      index !== null && indexMatchesMountedRows(rowIds, index) ? index : null;
    const positions = positionMountedRows(rowIds, usableIndex);
    const mountedRows = new Map<Element, MountedMatchRow>(
      rows.map((row, order) => [
        row,
        { id: rowIds[order] ?? null, position: positions[order] ?? order },
      ]),
    );
    const next = collectThreadFindMatches({
      ranges,
      rowOfRange: (range) => {
        const row =
          list === null ? null : topLevelRowOf(range.startContainer, list);
        return row === null ? null : (mountedRows.get(row) ?? null);
      },
      mountedRows: [...mountedRows.values()],
      index: usableIndex,
      query,
      observed: observedRef.current,
    });
    snapshotRef.current = { index: usableIndex, list };
    if (
      usableIndex !== null &&
      rowIds.some(
        (id) => id !== null && resolveRowPosition(usableIndex, id) === null,
      )
    ) {
      requestRefresh();
    }
    setMatches(next);
    if (scrollRequestRef.current === "first-visible") {
      const scroller =
        list === null ? null : findVerticalScroller(list, threadWindow);
      setActiveIndex(
        firstMatchAtOrBelowViewTop(
          next,
          (range) => isRangeBelowViewTop(range, scroller),
          lastRowPositionAboveViewBottom(rows, positions, scroller),
        ),
      );
      scrollRequestRef.current = "active";
      return;
    }
    setActiveIndex(resolveAnchoredIndex(next, anchorRef.current));
  }, [index, query, requestRefresh, threadWindow]);

  useEffect(() => {
    scrollRequestRef.current = "first-visible";
    anchorRef.current = null;
    observedRef.current = new Map();
  }, [query, threadWindow]);

  useEffect(() => {
    const frame = requestAnimationFrame(runSearch);
    return () => cancelAnimationFrame(frame);
  }, [runSearch]);

  useEffect(() => {
    if (query.length === 0) return;
    let timeout: number | null = null;
    const observer = new MutationObserver((records) => {
      if (records.every(isIgnoredMutation)) return;
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = window.setTimeout(runSearch, THREAD_FIND_RESEARCH_DELAY_MS);
    });
    observer.observe(threadWindow, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [query, runSearch, threadWindow]);

  useEffect(() => {
    const active = matches[activeIndex];
    if (active !== undefined) anchorRef.current = anchorOf(active);
    const ranges = matches.flatMap((match) =>
      match.kind === "dom" ? [match.range] : [],
    );
    paintThreadFindHighlights(
      ranges,
      active?.kind === "dom" ? active.range : undefined,
    );
  }, [activeIndex, matches]);

  useEffect(
    () => () => {
      mountRef.current?.controller.abort();
      clearThreadFindHighlights();
    },
    [],
  );

  useEffect(() => {
    if (scrollRequestRef.current !== "active") return;
    const active = matches[activeIndex];
    if (active === undefined) return;
    if (active.kind === "dom") {
      scrollRequestRef.current = null;
      mountRef.current?.controller.abort();
      mountRef.current = null;
      revealRange(active.range, threadWindow);
      return;
    }
    if (mountRef.current?.rowId === active.rowId) return;
    mountRef.current?.controller.abort();
    const { index: searchedIndex, list } = snapshotRef.current;
    const scroller =
      list === null ? null : findVerticalScroller(list, threadWindow);
    if (searchedIndex === null || list === null || scroller === null) {
      scrollRequestRef.current = null;
      return;
    }
    const controller = new AbortController();
    mountRef.current = { rowId: active.rowId, controller };
    void scrollUntilRowMounted({
      list,
      scroller,
      rowId: active.rowId,
      targetPosition: active.position,
      rowCount: searchedIndex.rowIds.length,
      positionOf: (rowId) => resolveRowPosition(searchedIndex, rowId),
      signal: controller.signal,
    }).then((row) => {
      if (controller.signal.aborted) return;
      mountRef.current = null;
      if (row === null) {
        scrollRequestRef.current = null;
        return;
      }
      runSearch();
    });
  }, [activeIndex, matches, runSearch, threadWindow]);

  const step = useCallback(
    (direction: 1 | -1) => {
      if (matches.length === 0) return;
      scrollRequestRef.current = "active";
      setActiveIndex(
        (previous) => (previous + direction + matches.length) % matches.length,
      );
    },
    [matches.length],
  );

  const close = useCallback(() => {
    const closed = closeThreadFind();
    const restoreTarget = closed?.restoreFocus ?? null;
    if (restoreTarget?.isConnected) restoreTarget.focus();
  }, []);

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" || isFindAgainShortcut(event)) {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  if (position === null) return null;
  const status = formatMatchStatus(query, matches.length, activeIndex);
  return (
    <div
      role="search"
      data-thread-find=""
      style={{ top: position.top, right: position.right }}
      className="fixed z-40 flex items-center gap-1 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <Icon
        name="Search"
        className="ml-1.5 size-3.5 text-muted-foreground"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="text"
        aria-label="Find in thread"
        placeholder="Find in thread"
        value={query}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleInputKeyDown}
        className="h-7 w-48 min-w-0 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
      />
      <span
        aria-live="polite"
        className="min-w-12 text-right text-xs tabular-nums text-muted-foreground"
      >
        {status}
      </span>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Previous match"
        disabled={matches.length === 0}
        onClick={() => step(-1)}
        className="size-7"
      >
        <Icon name="ChevronUp" className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Next match"
        disabled={matches.length === 0}
        onClick={() => step(1)}
        className="size-7"
      >
        <Icon name="ChevronDown" className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Close find"
        onClick={close}
        className="size-7"
      >
        <Icon name="X" className="size-3.5" />
      </Button>
    </div>
  );
}

export function ThreadFindOverlay() {
  const session = useSyncExternalStore(
    subscribeThreadFind,
    getThreadFindSession,
  );
  const [query, setQuery] = useState("");
  useFindShortcut();
  useEffect(
    () => () => {
      closeThreadFind();
    },
    [],
  );
  if (session === null) return null;
  return (
    <ThreadFindBar session={session} query={query} onQueryChange={setQuery} />
  );
}
