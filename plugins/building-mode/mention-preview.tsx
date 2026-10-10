import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { z } from "zod";
import { experimental_usePluginId, useRpc } from "@get-bb/plugin-sdk/app";
import { ANNOTATION_MENTION_PROVIDER_ID } from "./annotations.js";
import type { buildingModeRpcContract } from "./server.js";

export const MENTION_PREVIEW_OPEN_DELAY_MS = 350;
export const MENTION_PREVIEW_CLOSE_DELAY_MS = 150;

const PILL_SELECTOR = ".prompt-mention-pill[data-prompt-mention-resource]";
const PREVIEW_MAX_WIDTH = 512;
const PREVIEW_MAX_HEIGHT = 384;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

const pluginMentionResourceSchema = z.object({
  kind: z.literal("plugin"),
  pluginId: z.string(),
  itemId: z.string(),
});

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function annotationIdForPill(
  pill: Element,
  pluginId: string,
): string | null {
  const raw = pill.getAttribute("data-prompt-mention-resource");
  if (raw === null) return null;
  const parsed = pluginMentionResourceSchema.safeParse(parseJson(raw));
  if (!parsed.success || parsed.data.pluginId !== pluginId) return null;
  const prefix = `${ANNOTATION_MENTION_PROVIDER_ID}:`;
  const { itemId } = parsed.data;
  return itemId.startsWith(prefix) && itemId.length > prefix.length
    ? itemId.slice(prefix.length)
    : null;
}

interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
}

interface Viewport {
  width: number;
  height: number;
}

export interface PreviewPlacement {
  left: number;
  width: number;
  maxHeight: number;
  top: number | null;
  bottom: number | null;
}

export function previewPlacement(
  anchor: AnchorRect,
  viewport: Viewport,
): PreviewPlacement {
  const width = Math.max(
    0,
    Math.min(PREVIEW_MAX_WIDTH, viewport.width - VIEWPORT_MARGIN * 2),
  );
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(anchor.left, viewport.width - width - VIEWPORT_MARGIN),
  );
  const spaceAbove = anchor.top - ANCHOR_GAP - VIEWPORT_MARGIN;
  const spaceBelow =
    viewport.height - anchor.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
  if (spaceAbove >= Math.min(PREVIEW_MAX_HEIGHT, spaceBelow)) {
    return {
      left,
      width,
      maxHeight: Math.max(0, Math.min(PREVIEW_MAX_HEIGHT, spaceAbove)),
      top: null,
      bottom: viewport.height - anchor.top + ANCHOR_GAP,
    };
  }
  return {
    left,
    width,
    maxHeight: Math.max(0, Math.min(PREVIEW_MAX_HEIGHT, spaceBelow)),
    top: anchor.bottom + ANCHOR_GAP,
    bottom: null,
  };
}

type PreviewContent =
  | { status: "loading" }
  | { status: "ready"; context: string }
  | { status: "missing" }
  | { status: "error"; message: string };

interface LoadedContent {
  id: string;
  content: PreviewContent;
}

interface ActivePreview {
  pill: Element;
  id: string;
}

function placementStyle(placement: PreviewPlacement): CSSProperties {
  return {
    left: placement.left,
    width: placement.width,
    maxHeight: placement.maxHeight,
    ...(placement.top === null ? {} : { top: placement.top }),
    ...(placement.bottom === null ? {} : { bottom: placement.bottom }),
  };
}

function PreviewBody({ content }: { content: PreviewContent }) {
  if (content.status === "loading") {
    return <p className="text-muted-foreground">Loading prompt…</p>;
  }
  if (content.status === "missing") {
    return (
      <p className="text-muted-foreground">
        This annotation is no longer available.
      </p>
    );
  }
  if (content.status === "error") {
    return <p className="text-destructive">{content.message}</p>;
  }
  return <p className="whitespace-pre-wrap break-words">{content.context}</p>;
}

export function AnnotationMentionPreviewOverlay() {
  const pluginId = experimental_usePluginId();
  const rpc = useRpc<typeof buildingModeRpcContract>();
  const [active, setActive] = useState<ActivePreview | null>(null);
  const [loaded, setLoaded] = useState<LoadedContent | null>(null);
  const [, setLayoutTick] = useState(0);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<ActivePreview | null>(null);
  const rpcRef = useRef(rpc);

  useLayoutEffect(() => {
    activeRef.current = active;
    rpcRef.current = rpc;
  });

  useEffect(() => {
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let pending: ActivePreview | null = null;

    function cancelOpen() {
      clearTimeout(openTimer);
      pending = null;
    }
    function cancelClose() {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
    function closeNow() {
      cancelOpen();
      cancelClose();
      setActive(null);
    }
    function scheduleClose() {
      cancelOpen();
      if (activeRef.current === null || closeTimer !== undefined) return;
      closeTimer = setTimeout(() => {
        closeTimer = undefined;
        setActive(null);
      }, MENTION_PREVIEW_CLOSE_DELAY_MS);
    }
    function hover(target: EventTarget | null) {
      const element = target instanceof Element ? target : null;
      if (element !== null && popoverRef.current?.contains(element)) {
        cancelOpen();
        cancelClose();
        return;
      }
      const pill = element?.closest(PILL_SELECTOR) ?? null;
      const id = pill === null ? null : annotationIdForPill(pill, pluginId);
      if (pill === null || id === null) {
        scheduleClose();
        return;
      }
      cancelClose();
      if (activeRef.current?.pill === pill || pending?.pill === pill) return;
      cancelOpen();
      const next = { pill, id };
      pending = next;
      openTimer = setTimeout(() => {
        pending = null;
        setActive(next);
      }, MENTION_PREVIEW_OPEN_DELAY_MS);
    }
    function onPointerOver(event: PointerEvent) {
      hover(event.target);
    }
    function onPointerOut(event: PointerEvent) {
      if (!(event.relatedTarget instanceof Node)) scheduleClose();
    }
    function onPointerDown(event: PointerEvent) {
      const element = event.target instanceof Element ? event.target : null;
      if (element !== null && popoverRef.current?.contains(element)) return;
      closeNow();
    }
    function onKeyDown() {
      closeNow();
    }
    function relayout(event: Event) {
      const element = event.target instanceof Element ? event.target : null;
      if (element !== null && popoverRef.current?.contains(element)) return;
      if (activeRef.current !== null) setLayoutTick((tick) => tick + 1);
    }

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", relayout, true);
    window.addEventListener("resize", relayout);
    window.addEventListener("blur", closeNow);
    return () => {
      cancelOpen();
      cancelClose();
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", relayout, true);
      window.removeEventListener("resize", relayout);
      window.removeEventListener("blur", closeNow);
    };
  }, [pluginId]);

  useEffect(() => {
    if (active === null) return;
    const { id } = active;
    let current = true;
    rpcRef.current.call("preview", { id }).then(
      ({ context }) => {
        if (!current) return;
        setLoaded({
          id,
          content:
            context === null
              ? { status: "missing" }
              : { status: "ready", context },
        });
      },
      (cause: unknown) => {
        if (!current) return;
        setLoaded({
          id,
          content: {
            status: "error",
            message: cause instanceof Error ? cause.message : String(cause),
          },
        });
      },
    );
    return () => {
      current = false;
    };
  }, [active]);

  if (active === null || !active.pill.isConnected) return null;
  const content: PreviewContent =
    loaded !== null && loaded.id === active.id
      ? loaded.content
      : { status: "loading" };
  const rect = active.pill.getBoundingClientRect();
  const placement = previewPlacement(rect, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  return (
    <div
      ref={popoverRef}
      role="tooltip"
      aria-label="Annotation prompt"
      data-building-mode-mention-preview=""
      onMouseDown={(event) => event.preventDefault()}
      style={placementStyle(placement)}
      className="pointer-events-auto fixed z-50 flex flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
    >
      <div className="shrink-0 border-b border-border px-3 py-1.5 text-2xs text-muted-foreground">
        Prompt sent with this annotation
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-3 py-2 text-xs">
        <PreviewBody content={content} />
      </div>
    </div>
  );
}
