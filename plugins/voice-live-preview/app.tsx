import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  definePluginApp,
  useComposer,
  useComposerView,
  useSdk,
  type PluginBrowserBbSdk,
  type PluginCommandRegistration,
  type PluginComposerApi,
  type PluginComposerScope,
} from "@get-bb/plugin-sdk/app";
import {
  hasDictateTarget,
  registerDictateTarget,
  runDictate,
} from "./dictate-registry.js";
import {
  readVoiceUnsupportedReason,
  voiceUnsupportedMessage,
} from "./recorder.js";
import {
  appendTranscript,
  createVoiceSession,
  type VoicePreview,
  type VoiceSessionDeps,
} from "./voice-session.js";
import "./app.css";

const DICTATE_SHORTCUT_LABEL = "⌃V";

export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/u.test(navigator.platform)
  );
}

export function composerScopeKey(scope: PluginComposerScope): string {
  switch (scope.kind) {
    case "thread":
      return `thread:${scope.threadId}`;
    case "queued-message":
      return `queued-message:${scope.queuedMessageId}`;
    case "side-chat":
      return `side-chat:${scope.tabId}`;
    case "new-thread":
      return `new-thread:${scope.projectId ?? ""}`;
  }
}

const fallbackPreviews = new Map<string, string>();
const fallbackListeners = new Set<() => void>();

function setFallbackPreview(scopeKey: string, text: string | null): void {
  if (text === null) fallbackPreviews.delete(scopeKey);
  else fallbackPreviews.set(scopeKey, text);
  for (const listener of [...fallbackListeners]) listener();
}

function subscribeFallbackPreviews(listener: () => void): () => void {
  fallbackListeners.add(listener);
  return () => {
    fallbackListeners.delete(listener);
  };
}

type PreviewComposer = Pick<PluginComposerApi, "updateText"> &
  Partial<Pick<PluginComposerApi, "experimental_beginProvisionalText">>;

function createFallbackPreview(
  scopeKey: string,
  composer: PreviewComposer,
): VoicePreview {
  let ended = false;
  setFallbackPreview(scopeKey, "");
  return {
    update(text) {
      if (!ended) setFallbackPreview(scopeKey, text);
    },
    commit(text) {
      if (ended) return;
      ended = true;
      setFallbackPreview(scopeKey, null);
      composer.updateText((current) => appendTranscript(current, text));
    },
    cancel() {
      if (ended) return;
      ended = true;
      setFallbackPreview(scopeKey, null);
    },
  };
}

export function beginVoicePreview(
  composer: PreviewComposer,
  scopeKey: string,
): VoicePreview {
  return (
    composer.experimental_beginProvisionalText?.() ??
    createFallbackPreview(scopeKey, composer)
  );
}

export function createDictateCommand(
  isMac: boolean,
): PluginCommandRegistration {
  return {
    id: "dictate",
    title: "Voice: dictate into the composer",
    ...(isMac ? { defaultShortcut: { key: "v", control: true } } : {}),
    isAvailable: () => hasDictateTarget(),
    run: () => {
      runDictate();
    },
  };
}

let cachedVoiceEnabled: boolean | null = null;
let voiceEnabledRequest: Promise<boolean> | null = null;

function fetchVoiceEnabled(sdk: PluginBrowserBbSdk): Promise<boolean> {
  voiceEnabledRequest ??= sdk.system
    .config()
    .then((config) => config.voiceTranscriptionEnabled)
    .finally(() => {
      voiceEnabledRequest = null;
    });
  return voiceEnabledRequest;
}

function useVoiceTranscriptionEnabled(sdk: PluginBrowserBbSdk): boolean {
  const [enabled, setEnabled] = useState(cachedVoiceEnabled ?? false);
  useEffect(() => {
    let active = true;
    fetchVoiceEnabled(sdk).then(
      (value) => {
        cachedVoiceEnabled = value;
        if (active) setEnabled(value);
      },
      () => {
        if (active) setEnabled(false);
      },
    );
    return () => {
      active = false;
    };
  }, [sdk]);
  return enabled;
}

function DictateAction() {
  const composer = useComposer();
  const view = useComposerView();
  const sdk = useSdk();
  const enabled = useVoiceTranscriptionEnabled(sdk);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const scopeKey = composerScopeKey(view.scope);

  const deps: VoiceSessionDeps = {
    transcribe: async ({ file, prompt, signal }) =>
      (await sdk.system.transcribeVoice({ file, prompt, signal })).text,
    beginPreview: () => beginVoicePreview(composer, scopeKey),
    getPrompt: () => {
      const text = composer.text.trim();
      return text.length > 0 ? text : undefined;
    },
    toast: {
      error: (title, options) => toast.error(title, options),
      warning: (title, options) => toast.warning(title, options),
    },
  };
  const [session] = useState(() => createVoiceSession(deps));
  useLayoutEffect(() => {
    session.setDeps(deps);
  });
  useEffect(() => () => session.dispose(), [session]);
  const state = useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );

  const toggle = useCallback(() => session.toggle(), [session]);
  useEffect(() => {
    if (!enabled) return;
    const registration = registerDictateTarget({
      root: () => rootRef.current?.closest("form") ?? rootRef.current,
      toggle,
    });
    const root = rootRef.current?.closest("form") ?? rootRef.current;
    const onFocusIn = () => registration.markFocused();
    root?.addEventListener("focusin", onFocusIn);
    if (root?.contains(document.activeElement)) registration.markFocused();
    return () => {
      root?.removeEventListener("focusin", onFocusIn);
      registration.unregister();
    };
  }, [enabled, toggle]);

  if (!enabled) return null;

  const unsupported = readVoiceUnsupportedReason();
  const isMac = isMacPlatform();

  if (state === "idle") {
    const button = (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={
          unsupported === null
            ? "Start dictation"
            : voiceUnsupportedMessage(unsupported)
        }
        aria-keyshortcuts={isMac ? "Control+V" : undefined}
        disabled={unsupported !== null || view.run.isSubmitting}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => void session.start()}
        className={COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS}
      >
        <Icon name="Mic" className="size-4" />
      </Button>
    );
    return (
      <span ref={rootRef} data-voice-live-preview="" className="contents">
        {isMac && unsupported === null ? (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="top">
                {`${DICTATE_SHORTCUT_LABEL} to dictate`}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          button
        )}
      </span>
    );
  }

  const isTranscribing = state === "transcribing";
  return (
    <span
      ref={rootRef}
      data-voice-live-preview=""
      data-voice-state={state}
      className="contents"
    >
      <span className="sr-only" aria-live="polite">
        {isTranscribing ? "Transcribing" : "Recording"}
      </span>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={
          isTranscribing ? "Cancel transcription" : "Cancel recording"
        }
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => session.cancel()}
        className={COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS}
      >
        <Icon name="X" className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="default"
        aria-label={
          isTranscribing
            ? "Transcribing voice input"
            : "Stop and transcribe recording"
        }
        disabled={isTranscribing}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => session.stop()}
        className={COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS}
      >
        {isTranscribing ? (
          <Icon name="Spinner" className="size-4 animate-spin" />
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="size-2 animate-pulse rounded-full bg-destructive motion-reduce:animate-none" />
            <Icon name="Check" className="size-4" />
          </span>
        )}
      </Button>
    </span>
  );
}

function FallbackPreviewBanner() {
  const view = useComposerView();
  const scopeKey = composerScopeKey(view.scope);
  const text = useSyncExternalStore(
    subscribeFallbackPreviews,
    () => fallbackPreviews.get(scopeKey) ?? null,
    () => null,
  );
  if (text === null) return null;
  return (
    <div
      data-voice-live-preview-banner=""
      aria-hidden="true"
      className="rounded-lg border border-border bg-surface-recessed px-3 py-2 text-sm text-muted-foreground"
    >
      {text.length > 0 ? text : "Listening…"}
    </div>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "voice-live-preview",
    scopes: ["thread", "new-thread", "side-chat"],
    actions: [{ id: "dictate", component: DictateAction }],
    banners: [
      { id: "preview", chrome: "bare", component: FallbackPreviewBanner },
    ],
  });
  app.commands.register(createDictateCommand(isMacPlatform()));
});
