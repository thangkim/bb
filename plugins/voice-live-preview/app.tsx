import { toast } from "sonner";
import {
  useEffect,
  useMemo,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  useComposer,
  useRpc,
  useSdk,
  type ExperimentalComposerCommandRegistration,
  type PluginComposerApi,
} from "@get-bb/plugin-sdk/app";
import {
  findComposerForm,
  insertTranscript,
  MIC_KEY_ATTRIBUTE,
} from "./composer-insert.js";
import type { voiceLivePreviewRpcContract } from "./contract.js";
import { fetchDraftPolicy } from "./draft-cadence.js";
import { hideNativeMic } from "./native-mic.js";
import {
  readVoiceUnsupportedReason,
  voiceUnsupportedMessage,
} from "./recorder.js";
import type {
  VoiceSession,
  VoiceSessionState,
  VoiceTarget,
} from "./voice-session.js";
import {
  cancelActiveVoiceSessions,
  disposeVoiceSessions,
  hasVoiceClients,
  provideVoiceClients,
  retainVoiceSession,
  voiceSessionFor,
} from "./voice-store.js";

const ICON_BUTTON_CLASS =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 max-md:pointer-coarse:h-10 max-md:pointer-coarse:px-3";
const BANNER_BUTTON_CLASS =
  "inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/u.test(navigator.platform)
  );
}

export function composerTarget(composer: PluginComposerApi): VoiceTarget {
  return {
    promptContext: () => composer.text,
    insert: (text) =>
      insertTranscript(
        composer,
        findComposerForm(document, composer.key),
        text,
      ),
  };
}

export function createDictateCommand(
  isMac: boolean,
): ExperimentalComposerCommandRegistration {
  return {
    id: "dictate",
    title: "Voice: dictate into the composer",
    ...(isMac ? { defaultShortcut: { key: "v", control: true } } : {}),
    run: ({ composer }) => {
      if (!hasVoiceClients()) {
        toast.error("Voice input is not ready");
        return;
      }
      return voiceSessionFor(composer.key).toggle(composerTarget(composer));
    },
  };
}

function useProvideVoiceClients(): void {
  const sdk = useSdk();
  const rpc = useRpc<typeof voiceLivePreviewRpcContract>();
  useEffect(() => {
    provideVoiceClients({
      transcribe: async (audio, prompt, signal) => {
        const result = await sdk.system.transcribeVoice({
          file: audio,
          ...(prompt === undefined ? {} : { prompt }),
          signal,
        });
        return result.text;
      },
      draftPolicy: () => fetchDraftPolicy(rpc),
    });
  }, [sdk, rpc]);
}

function useVoiceSession(composer: PluginComposerApi): {
  session: VoiceSession;
  state: VoiceSessionState;
} {
  useProvideVoiceClients();
  const session = voiceSessionFor(composer.key);
  const state = useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );
  useEffect(() => retainVoiceSession(composer.key), [composer.key]);
  return { session, state };
}

function keepEditorCaret(event: ReactPointerEvent<HTMLButtonElement>): void {
  if (event.button === 0) event.preventDefault();
}

function MicAction() {
  const composer = useComposer();
  const { session, state } = useVoiceSession(composer);
  const unsupported = useMemo(() => readVoiceUnsupportedReason(), []);
  const markerProps = { [MIC_KEY_ATTRIBUTE]: composer.key };

  if (state.phase === "recording") {
    return (
      <span {...markerProps} className="inline-flex shrink-0 items-center">
        <button
          type="button"
          aria-label="Cancel dictation"
          title="Cancel dictation (Esc)"
          onPointerDown={keepEditorCaret}
          onClick={() => session.cancel()}
          className={ICON_BUTTON_CLASS}
        >
          <Icon name="X" className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Stop dictation and insert transcript"
          title="Stop dictation and insert transcript"
          onPointerDown={keepEditorCaret}
          onClick={() => void session.stop()}
          className={`${ICON_BUTTON_CLASS} text-foreground`}
        >
          <span
            aria-hidden
            className="size-2 animate-pulse rounded-full bg-destructive"
          />
          <Icon name="Check" className="size-4" aria-hidden />
        </button>
      </span>
    );
  }

  const busy = state.phase !== "idle";
  const label =
    unsupported !== null
      ? voiceUnsupportedMessage(unsupported)
      : state.phase === "starting"
        ? "Cancel dictation"
        : state.phase === "transcribing"
          ? "Transcribing dictation"
          : "Start dictation";
  return (
    <span {...markerProps} className="inline-flex shrink-0 items-center">
      <button
        type="button"
        aria-label={label}
        title={
          state.phase === "idle" && unsupported === null
            ? "Dictate with live preview"
            : label
        }
        aria-busy={busy || undefined}
        disabled={
          unsupported !== null ||
          state.phase === "transcribing" ||
          (state.phase === "idle" && composer.isSubmitting)
        }
        onPointerDown={keepEditorCaret}
        onClick={() => void session.toggle(composerTarget(composer))}
        className={ICON_BUTTON_CLASS}
      >
        <Icon
          name={busy ? "Spinner" : "Mic"}
          className={busy ? "size-4 animate-spin" : "size-4"}
          aria-hidden
        />
      </button>
    </span>
  );
}

function PreviewBanner() {
  const composer = useComposer();
  const { session, state } = useVoiceSession(composer);
  if (state.phase === "idle") return null;

  const status =
    state.phase === "starting"
      ? "Starting microphone…"
      : state.phase === "recording"
        ? "Listening…"
        : "Transcribing…";
  return (
    <div
      data-voice-live-preview-banner=""
      className="flex flex-col gap-1 px-3 py-1.5"
    >
      <div className="flex min-h-6 items-center gap-2">
        <span
          aria-hidden
          className={
            state.phase === "recording"
              ? "size-2 shrink-0 animate-pulse rounded-full bg-destructive"
              : "size-2 shrink-0 rounded-full bg-muted-foreground"
          }
        />
        <span
          role="status"
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
        >
          {status}
        </span>
        {state.phase === "recording" ? (
          <button
            type="button"
            onPointerDown={keepEditorCaret}
            onClick={() => void session.stop()}
            className={BANNER_BUTTON_CLASS}
          >
            <Icon name="Check" className="size-3.5" aria-hidden />
            Insert
          </button>
        ) : null}
        <button
          type="button"
          onPointerDown={keepEditorCaret}
          onClick={() => session.cancel()}
          className={BANNER_BUTTON_CLASS}
        >
          <Icon name="X" className="size-3.5" aria-hidden />
          Cancel
        </button>
      </div>
      {state.draft.length > 0 ? (
        <p
          data-voice-live-preview-draft=""
          className="whitespace-pre-wrap break-words text-sm text-muted-foreground"
        >
          {state.draft}
        </p>
      ) : null}
    </div>
  );
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) {
    return;
  }
  if (!cancelActiveVoiceSessions()) return;
  event.preventDefault();
  event.stopPropagation();
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "voice-live-preview",
    actions: [{ id: "mic", component: MicAction }],
    banners: [{ id: "live-draft", chrome: "card", component: PreviewBanner }],
  });
  app.composer.experimental_registerCommand(
    createDictateCommand(isMacPlatform()),
  );
  app.contentScripts.register({
    id: "voice-input",
    mount: ({ pluginId }) => {
      const showNativeMic = hideNativeMic(document, pluginId);
      window.addEventListener("keydown", handleEscape, true);
      return () => {
        window.removeEventListener("keydown", handleEscape, true);
        showNativeMic();
        disposeVoiceSessions();
      };
    },
  });
});
