import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { toast } from "sonner";
import { copyImageWithToast } from "./image-copy";
import {
  placeImageContextMenu,
  resolveImageContextTarget,
  type ImageContextTarget,
} from "./image-context-menu";

const MENU_ITEM_SELECTOR = '[role="menuitem"]';
const SWALLOW_DISMISS_CLICK_MS = 1000;

interface MenuAction {
  id: string;
  label: string;
  group: number;
  run: () => void;
}

function writeText(text: string, failure: string): void {
  if (typeof navigator.clipboard?.writeText !== "function") {
    toast.error(failure);
    return;
  }
  void navigator.clipboard.writeText(text).catch(() => {
    toast.error(failure);
  });
}

function menuActions(target: ImageContextTarget): MenuAction[] {
  const actions: MenuAction[] = [
    {
      id: "copy-image",
      label: "Copy Image",
      group: 0,
      run: () => void copyImageWithToast(target.imageUrl),
    },
  ];
  const { linkUrl, selectionText } = target;
  if (linkUrl !== null) {
    actions.push({
      id: "copy-link",
      label: "Copy Link",
      group: 1,
      run: () => writeText(linkUrl, "Failed to copy link"),
    });
  }
  if (selectionText.length > 0) {
    actions.push({
      id: "copy-selection",
      label: "Copy",
      group: 2,
      run: () => writeText(selectionText, "Failed to copy text"),
    });
  }
  return actions;
}

function swallowNextClick(): void {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => {
    window.removeEventListener("click", swallow, true);
  }, SWALLOW_DISMISS_CLICK_MS);
}

function menuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR));
}

function focusItem(
  menu: HTMLElement,
  pick: (count: number, current: number) => number,
) {
  const items = menuItems(menu);
  if (items.length === 0) return;
  const current = items.findIndex((item) => item === document.activeElement);
  items[pick(items.length, current)]?.focus({ preventScroll: true });
}

export function ImageContextMenuOverlay() {
  const [target, setTarget] = useState<ImageContextTarget | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const close = useCallback(() => setTarget(null), []);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const menu = menuRef.current;
      if (
        menu !== null &&
        event.target instanceof Node &&
        menu.contains(event.target)
      ) {
        event.preventDefault();
        return;
      }
      const next = resolveImageContextTarget(
        event,
        window.getSelection()?.toString() ?? "",
      );
      if (next !== null) {
        event.preventDefault();
        if (menu === null) {
          const active = document.activeElement;
          returnFocusRef.current =
            active instanceof HTMLElement && active !== document.body
              ? active
              : null;
        }
      }
      setTarget(next);
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (target === null || menu === null) return;
    const rect = menu.getBoundingClientRect();
    const { left, top } = placeImageContextMenu(
      target,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = "visible";
    menuItems(menu)[0]?.focus({ preventScroll: true });
  }, [target]);

  const isOpen = target !== null;
  useEffect(() => {
    if (!isOpen) return;
    const isInsideMenu = (node: EventTarget | null) =>
      node instanceof Node && menuRef.current?.contains(node) === true;

    const onPointerDown = (event: PointerEvent) => {
      if (isInsideMenu(event.target)) return;
      close();
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      swallowNextClick();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      } else if (event.key === "Tab") {
        close();
      }
    };
    const onScroll = (event: Event) => {
      if (!isInsideMenu(event.target)) close();
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      const returnFocus = returnFocusRef.current;
      returnFocusRef.current = null;
      const active = document.activeElement;
      if (
        returnFocus?.isConnected === true &&
        (active === null || active === document.body || isInsideMenu(active))
      ) {
        returnFocus.focus({ preventScroll: true });
      }
    };
  }, [close, isOpen]);

  if (target === null) return null;

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const menu = event.currentTarget;
    const moves: Record<string, (count: number, current: number) => number> = {
      ArrowDown: (count, current) => (current + 1) % count,
      ArrowUp: (count, current) => (current <= 0 ? count - 1 : current - 1),
      Home: () => 0,
      End: (count) => count - 1,
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    focusItem(menu, move);
  };

  const actions = menuActions(target);
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Image"
      aria-orientation="vertical"
      data-image-copy-menu=""
      className="fixed z-[60] flex min-w-36 flex-col overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: target.x, top: target.y, visibility: "hidden" }}
      onKeyDown={onMenuKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {actions.map((action, index) => (
        <div key={action.id} className="contents">
          {index > 0 && actions[index - 1]?.group !== action.group ? (
            <div role="separator" className="-mx-1 my-1 h-px bg-muted" />
          ) : null}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="flex w-full cursor-default select-none items-center rounded-sm px-2 py-[0.3125rem] text-left text-xs outline-none focus:bg-state-hover focus:text-foreground"
            onMouseDown={(event) => event.preventDefault()}
            onPointerMove={(event) =>
              event.currentTarget.focus({ preventScroll: true })
            }
            onClick={() => {
              action.run();
              close();
            }}
          >
            {action.label}
          </button>
        </div>
      ))}
    </div>
  );
}
