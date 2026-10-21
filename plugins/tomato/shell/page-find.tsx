import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  clearPageFindHighlights,
  findTextMatches,
  paintPageFindHighlights,
  revealMatch,
} from "./page-find-matches.js";
import "./page-find.css";

export const PAGE_FIND_RESEARCH_DELAY_MS = 150;
const PAGE_FIND_BAR_ATTRIBUTE = "data-tomato-find";
const BAR_TOP_INSET_PX = 8;
const BAR_RIGHT_INSET_PX = 20;
const MAX_PREFILL_LENGTH = 80;

interface BarPosition {
  top: number;
  right: number;
}

interface FindSession {
  request: number;
  restoreFocus: HTMLElement | null;
}

function isMacPlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/u.test(platform);
}

function hasModifier(
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">,
  isMac: boolean,
): boolean {
  return isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

export function isFindShortcut(event: KeyboardEvent, isMac: boolean): boolean {
  return (
    event.key.toLowerCase() === "f" &&
    !event.altKey &&
    !event.shiftKey &&
    hasModifier(event, isMac)
  );
}

function isFindAgainShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
  >,
  isMac: boolean,
): boolean {
  return (
    event.key.toLowerCase() === "g" &&
    !event.altKey &&
    hasModifier(event, isMac)
  );
}

function isInsideFindBar(element: Element | null): boolean {
  return element?.closest(`[${PAGE_FIND_BAR_ATTRIBUTE}]`) != null;
}

function hasOpenModal(doc: Document): boolean {
  return (
    doc.querySelector(
      '[aria-modal="true"]:not([inert]), [role="dialog"][data-state="open"]',
    ) !== null
  );
}

export function ownsFindShortcut(
  event: KeyboardEvent,
  root: HTMLElement,
): boolean {
  const target = event.target instanceof Element ? event.target : null;
  if (target !== null && root.contains(target)) return true;
  const idle =
    target === null ||
    target === root.ownerDocument.body ||
    target === root.ownerDocument.documentElement;
  if (!idle) return false;
  const pane = root.closest("[data-split-pane-id]");
  return pane === null || pane.getAttribute("data-focused") === "true";
}

function selectedQuery(root: HTMLElement): string {
  const selection = root.ownerDocument.getSelection();
  if (selection === null || selection.isCollapsed) return "";
  const text = selection.toString().trim();
  if (text.length === 0 || text.length > MAX_PREFILL_LENGTH) return "";
  if (/\n/u.test(text)) return "";
  const anchor = selection.anchorNode;
  return anchor !== null && root.contains(anchor) ? text : "";
}

function formatMatchStatus(query: string, count: number, active: number) {
  if (query.length === 0) return "";
  if (count === 0) return "No results";
  return `${active + 1}/${count}`;
}

function useBarPosition(anchor: HTMLElement | null): BarPosition | null {
  const [position, setPosition] = useState<BarPosition | null>(null);
  useLayoutEffect(() => {
    if (anchor === null) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
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
    observer?.observe(anchor);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [anchor]);
  return position;
}

interface PageFindBarProps {
  root: HTMLElement;
  anchor: HTMLElement;
  session: FindSession;
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
}

function PageFindBar({
  root,
  anchor,
  session,
  query,
  onQueryChange,
  onClose,
}: PageFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const revealRequestRef = useRef(false);
  const [matches, setMatches] = useState<readonly Range[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const position = useBarPosition(anchor);
  const isMac = isMacPlatform(navigator.platform);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [session.request]);

  const runSearch = useCallback(() => {
    const next = findTextMatches(root, query, isInsideFindBar);
    setMatches(next);
    setActiveIndex((previous) =>
      Math.min(previous, Math.max(next.length - 1, 0)),
    );
  }, [query, root]);

  useEffect(() => {
    revealRequestRef.current = true;
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const frame = requestAnimationFrame(runSearch);
    return () => cancelAnimationFrame(frame);
  }, [runSearch]);

  useEffect(() => {
    if (query.length === 0) return;
    let timeout: number | null = null;
    const observer = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        const target =
          record.target instanceof Element
            ? record.target
            : record.target.parentElement;
        return target !== null && !isInsideFindBar(target);
      });
      if (!relevant) return;
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = window.setTimeout(runSearch, PAGE_FIND_RESEARCH_DELAY_MS);
    });
    observer.observe(root, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [query, root, runSearch]);

  useEffect(() => {
    const active = matches[activeIndex];
    paintPageFindHighlights(matches, active);
    if (active !== undefined && revealRequestRef.current) {
      revealRequestRef.current = false;
      revealMatch(active);
    }
  }, [activeIndex, matches]);

  useEffect(() => clearPageFindHighlights, []);

  const step = useCallback(
    (direction: 1 | -1) => {
      if (matches.length === 0) return;
      revealRequestRef.current = true;
      setActiveIndex(
        (previous) => (previous + direction + matches.length) % matches.length,
      );
    },
    [matches.length],
  );

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" || isFindAgainShortcut(event, isMac)) {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  if (position === null) return null;
  return (
    <div
      role="search"
      {...{ [PAGE_FIND_BAR_ATTRIBUTE]: "" }}
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
        aria-label="Find in Tomato"
        placeholder="Find in Tomato"
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
        {formatMatchStatus(query, matches.length, activeIndex)}
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
        onClick={onClose}
        className="size-7"
      >
        <Icon name="X" className="size-3.5" />
      </Button>
    </div>
  );
}

interface PageFindProps {
  rootRef: RefObject<HTMLElement | null>;
  anchorRef: RefObject<HTMLElement | null>;
}

export function PageFind({ rootRef, anchorRef }: PageFindProps) {
  const [session, setSession] = useState<FindSession | null>(null);
  const [query, setQuery] = useState("");
  const requestRef = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const close = useCallback(() => {
    const restore = sessionRef.current?.restoreFocus ?? null;
    setSession(null);
    if (restore?.isConnected) restore.focus();
  }, []);

  useEffect(() => {
    const isMac = isMacPlatform(navigator.platform);
    const onKeyDown = (event: KeyboardEvent) => {
      const root = rootRef.current;
      if (root === null || event.defaultPrevented || event.isComposing) return;
      if (!isFindShortcut(event, isMac)) return;
      const target = event.target instanceof Element ? event.target : null;
      const insideBar = isInsideFindBar(target);
      if (!insideBar) {
        if (hasOpenModal(document)) return;
        if (!ownsFindShortcut(event, root)) return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      requestRef.current += 1;
      const request = requestRef.current;
      const prefill = insideBar ? "" : selectedQuery(root);
      if (prefill.length > 0) setQuery(prefill);
      setSession((previous) => ({
        request,
        restoreFocus:
          previous?.restoreFocus ??
          (document.activeElement instanceof HTMLElement &&
          !insideBar &&
          document.activeElement !== document.body
            ? document.activeElement
            : null),
      }));
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [rootRef]);

  const root = rootRef.current;
  const anchor = anchorRef.current;
  if (session === null || root === null || anchor === null) return null;
  return (
    <PageFindBar
      root={root}
      anchor={anchor}
      session={session}
      query={query}
      onQueryChange={setQuery}
      onClose={close}
    />
  );
}
