import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  THREAD_FIND_IGNORED_SELECTOR,
  THREAD_FIND_SEARCH_ROOT_SELECTOR,
  TIMELINE_RENDER_ALL_ATTRIBUTE,
  findVerticalScroller,
  firstMatchBelowViewportTop,
  isFindAgainShortcut,
  isMacPlatform,
  resolveFindShortcutTarget,
  revealRange,
} from "./thread-find-dom.js";
import {
  clearThreadFindHighlights,
  findTextMatches,
  paintThreadFindHighlights,
} from "./thread-find-matches.js";
import {
  closeThreadFind,
  getThreadFindSession,
  openThreadFind,
  refocusThreadFind,
  subscribeThreadFind,
  type ThreadFindSession,
} from "./thread-find-store.js";

export const THREAD_FIND_RESEARCH_DELAY_MS = 150;
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

function useRenderAllTimelineRows(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(TIMELINE_RENDER_ALL_ATTRIBUTE, "");
    return () => root.removeAttribute(TIMELINE_RENDER_ALL_ATTRIBUTE);
  }, []);
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

function ThreadFindBar({ session, query, onQueryChange }: ThreadFindBarProps) {
  const { threadWindow } = session;
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRequestRef = useRef<"first-visible" | "active" | null>(null);
  const [matches, setMatches] = useState<readonly Range[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const position = useBarPosition(threadWindow);
  useRenderAllTimelineRows();

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
    const root = threadWindow.querySelector(THREAD_FIND_SEARCH_ROOT_SELECTOR);
    const next =
      root === null ? [] : findTextMatches(root, query, isIgnoredElement);
    setMatches(next);
    if (scrollRequestRef.current === "first-visible") {
      const scroller =
        root === null ? null : findVerticalScroller(root, threadWindow);
      setActiveIndex(firstMatchBelowViewportTop(next, scroller));
      scrollRequestRef.current = "active";
      return;
    }
    setActiveIndex((previous) =>
      next.length === 0 ? 0 : Math.min(previous, next.length - 1),
    );
  }, [query, threadWindow]);

  useEffect(() => {
    scrollRequestRef.current = "first-visible";
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
    paintThreadFindHighlights(matches, activeIndex);
  }, [activeIndex, matches]);

  useEffect(() => clearThreadFindHighlights, []);

  useEffect(() => {
    if (scrollRequestRef.current !== "active") return;
    const active = matches[activeIndex];
    if (active === undefined) return;
    scrollRequestRef.current = null;
    revealRange(active, threadWindow);
  }, [activeIndex, matches, threadWindow]);

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
