import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { useAnnotationSession } from "./annotation-session.js";
import {
  appAnnotationTarget,
  onAppAnnotationToggle,
  requestAppAnnotationToggle,
} from "./app-target.js";

export const APP_ANNOTATION_COMMAND_ID = "annotate-app";

export function AppAnnotationsOverlay() {
  const { state, error, notice, toggle, clear, scope } =
    useAnnotationSession(appAnnotationTarget);
  const scopeKey = JSON.stringify(scope);
  const previousScopeKey = useRef(scopeKey);

  useEffect(() => onAppAnnotationToggle(toggle), [toggle]);

  useEffect(() => {
    if (previousScopeKey.current === scopeKey) return;
    previousScopeKey.current = scopeKey;
    clear().catch(() => undefined);
  }, [clear, scopeKey]);

  if (!state.active && error === null && notice === null) {
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
      {error ??
        notice ??
        "Annotating bb: click an element to comment. Esc to stop."}
    </div>
  );
}

export default definePluginApp((app) => {
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
