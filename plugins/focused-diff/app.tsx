import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_Diff as Diff,
  experimental_Icon as Icon,
  experimental_usePluginId as usePluginId,
  useBbNavigate,
  useSdk,
  type DiffViewMode,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import {
  countPatchLines,
  loadFocusedDiff,
  parseFocusedDiffParams,
  type FocusedDiffResult,
} from "./diff.js";
import {
  COMPOSER_SHELL_SELECTOR,
  FOCUSED_DIFF_REFRESH_EVENT,
  fileName,
  readChangedFileClickPath,
} from "./intercept.js";

export const FOCUSED_DIFF_ACTION_ID = "file";
const POLL_INTERVAL_MS = 10_000;
const VIEW_MODE_OPTIONS: ReadonlyArray<{
  mode: DiffViewMode;
  label: string;
  icon: "Rows2" | "Columns2";
}> = [
  { mode: "unified", label: "Unified diff view", icon: "Rows2" },
  { mode: "split", label: "Split diff view", icon: "Columns2" },
];

type PanelState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | FocusedDiffResult;

function ChangedFileClickInterceptor() {
  const markerRef = useRef<HTMLSpanElement>(null);
  const { openThreadPanel } = useBbNavigate();

  useEffect(() => {
    const shell = markerRef.current?.closest(COMPOSER_SHELL_SELECTOR);
    if (!shell) return;
    const onClick = (event: Event) => {
      if (!(event instanceof MouseEvent)) return;
      const path = readChangedFileClickPath(event, shell);
      if (path === null) return;
      const opened = openThreadPanel({
        actionId: FOCUSED_DIFF_ACTION_ID,
        title: fileName(path),
        params: { path },
      });
      if (!opened) return;
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(
        new CustomEvent(FOCUSED_DIFF_REFRESH_EVENT, { detail: path }),
      );
    };
    shell.addEventListener("click", onClick, true);
    return () => shell.removeEventListener("click", onClick, true);
  }, [openThreadPanel]);

  return <span ref={markerRef} hidden />;
}

function useFocusedDiff(threadId: string, path: string) {
  const sdk = useSdk();
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    loadFocusedDiff(sdk, threadId, path, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setState(result);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }, [sdk, threadId, path]);

  useEffect(() => {
    setState({ kind: "loading" });
    refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onRefreshRequest = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === path) refresh();
    };
    const interval = window.setInterval(refreshWhenVisible, POLL_INTERVAL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener(FOCUSED_DIFF_REFRESH_EVENT, onRefreshRequest);
    return () => {
      controllerRef.current?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener(FOCUSED_DIFF_REFRESH_EVENT, onRefreshRequest);
    };
  }, [refresh, path]);

  return { state, refresh };
}

function readViewMode(storageKey: string): DiffViewMode {
  try {
    return window.localStorage.getItem(storageKey) === "split"
      ? "split"
      : "unified";
  } catch {
    return "unified";
  }
}

function useDiffViewMode() {
  const storageKey = `bb.${usePluginId()}.view-mode`;
  const [viewMode, setViewModeState] = useState<DiffViewMode>(() =>
    readViewMode(storageKey),
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) setViewModeState(readViewMode(storageKey));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  const setViewMode = useCallback(
    (next: DiffViewMode) => {
      setViewModeState(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        return;
      }
    },
    [storageKey],
  );

  return { viewMode, setViewMode };
}

function ViewModeToggle({
  viewMode,
  onChange,
}: {
  viewMode: DiffViewMode;
  onChange: (mode: DiffViewMode) => void;
}) {
  return (
    <div
      className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5"
      role="group"
      aria-label="Diff view mode"
    >
      {VIEW_MODE_OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          aria-label={option.label}
          aria-pressed={viewMode === option.mode}
          title={option.label}
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-state-active aria-pressed:text-foreground"
          onClick={() => onChange(option.mode)}
        >
          <Icon name={option.icon} className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

function PanelMessage({ children }: { children: string }) {
  return (
    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function FocusedFileDiff({
  threadId,
  path,
}: {
  threadId: string;
  path: string;
}) {
  const { state, refresh } = useFocusedDiff(threadId, path);
  const { viewMode, setViewMode } = useDiffViewMode();
  const stats = state.kind === "patch" ? countPatchLines(state.patch) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-w-0 items-center gap-2 border-b border-border px-4 py-2">
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
          title={path}
        >
          {path}
        </span>
        {stats !== null ? (
          <span className="shrink-0 font-mono text-xs">
            <span className="text-diff-added">+{stats.insertions}</span>{" "}
            <span className="text-diff-removed">-{stats.deletions}</span>
          </span>
        ) : null}
        <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
        <button
          type="button"
          aria-label="Refresh diff"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={refresh}
        >
          <Icon name="RotateCcw" className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {state.kind === "loading" ? (
          <PanelMessage>Loading diff…</PanelMessage>
        ) : state.kind === "error" ? (
          <PanelMessage>{`Could not load the diff: ${state.message}`}</PanelMessage>
        ) : state.kind === "unavailable" ? (
          <PanelMessage>{state.message}</PanelMessage>
        ) : state.kind === "unchanged" ? (
          <PanelMessage>This file has no changes.</PanelMessage>
        ) : (
          <>
            {state.truncated ? (
              <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                This diff is too large and is shown truncated.
              </p>
            ) : null}
            <Diff patch={state.patch} path={path} view={viewMode} />
          </>
        )}
      </div>
    </div>
  );
}

function FocusedDiffPanel({ threadId, params }: PluginThreadPanelProps) {
  const path = parseFocusedDiffParams(params);
  if (path === null) {
    return (
      <PanelMessage>
        Click a changed file above the composer to see only its diff here.
      </PanelMessage>
    );
  }
  return <FocusedFileDiff key={path} threadId={threadId} path={path} />;
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "changed-file-clicks",
    scopes: ["thread"],
    banners: [
      {
        id: "changed-file-interceptor",
        chrome: "bare",
        component: ChangedFileClickInterceptor,
      },
    ],
  });
  app.slots.threadPanelAction({
    id: FOCUSED_DIFF_ACTION_ID,
    title: "File diff",
    icon: "FileDiff",
    component: FocusedDiffPanel,
    layout: "flush",
  });
});
