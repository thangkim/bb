import { useEffect, useMemo, useRef } from "react";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chrome-style-tokens";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  definePluginApp,
  type ExperimentalPluginBrowserPage,
  type ExperimentalPluginBrowserToolbarActionProps,
} from "@get-bb/plugin-sdk/app";
import { reactProbeSchema } from "./annotations.js";
import {
  useAnnotationSession,
  type AnnotationTarget,
} from "./annotation-session.js";
import {
  appAnnotationTarget,
  onAppAnnotationToggle,
  requestAppAnnotationToggle,
} from "./app-target.js";
import {
  buildActivateExpression,
  buildControllerExpression,
  buildReactProbeExpression,
} from "./page-script.js";

export const APP_ANNOTATION_COMMAND_ID = "annotate-app";

function browserPageTarget(
  page: ExperimentalPluginBrowserPage,
): AnnotationTarget {
  return {
    surface: "browser",
    activate: (theme) => page.evaluate(buildActivateExpression(theme)),
    control: (method) => page.evaluate(buildControllerExpression(method)),
    onMessage: (listener) => page.onMessage(listener),
    async readComponents(annotationId) {
      try {
        const parsed = reactProbeSchema.safeParse(
          await page.evaluate(buildReactProbeExpression(annotationId), {
            world: "main",
          }),
        );
        return parsed.success && parsed.data !== null
          ? parsed.data.components
          : [];
      } catch {
        return [];
      }
    },
    release() {
      page
        .evaluate(buildControllerExpression("deactivate"))
        .catch(() => undefined);
    },
  };
}

export function AnnotateAction({
  url,
  experimental_page: page,
}: ExperimentalPluginBrowserToolbarActionProps) {
  const target = useMemo(
    () => (page === null ? null : browserPageTarget(page)),
    [page],
  );
  const { state, error, toggle } = useAnnotationSession(target, url);

  const label =
    page === null
      ? "Annotate elements is available in the desktop app"
      : state.active
        ? "Stop annotating"
        : "Annotate elements";
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={state.active}
      disabled={page === null}
      onClick={toggle}
      title={error ?? label}
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-md transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
        state.active
          ? "bg-state-active text-foreground"
          : CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
        error !== null && "text-destructive",
      )}
    >
      <Icon name="MessageSquarePlus" aria-hidden />
      {state.count > 0 ? (
        <span
          data-testid="agent-annotations-count"
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs leading-none text-primary-foreground"
        >
          {state.count}
        </span>
      ) : null}
    </button>
  );
}

export function AppAnnotationsOverlay() {
  const { state, error, toggle, clear, scope } = useAnnotationSession(
    appAnnotationTarget,
    "",
  );
  const scopeKey = JSON.stringify(scope);
  const previousScopeKey = useRef(scopeKey);

  useEffect(() => onAppAnnotationToggle(toggle), [toggle]);

  useEffect(() => {
    if (previousScopeKey.current === scopeKey) return;
    previousScopeKey.current = scopeKey;
    clear().catch(() => undefined);
  }, [clear, scopeKey]);

  if (!state.active && error === null) {
    return null;
  }
  return (
    <div
      role="status"
      className={cn(
        "pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md",
        error !== null && "text-destructive",
      )}
    >
      {error ?? "Annotating bb: click an element to comment. Esc to stop."}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_browserToolbarAction({
    id: "annotate",
    title: "Agent annotations",
    component: AnnotateAction,
  });
  app.slots.experimental_appOverlay({
    id: "app-annotations",
    component: AppAnnotationsOverlay,
  });
  app.commands.register({
    id: APP_ANNOTATION_COMMAND_ID,
    title: "Annotate bb interface",
    defaultShortcut: { key: "b", alt: true, shift: true },
    run: requestAppAnnotationToggle,
  });
});
