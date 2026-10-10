import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { transcribeVoiceInput } from "@/lib/api";
import type { PromptDraftState } from "@bb/client-core";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import type { PromptBoxHandle, PromptVoiceConfig } from "./PromptBoxInternal";
import type { PromptVoiceSession } from "./plugin-voice-input";

async function requestVoiceTranscription({
  file,
  promptContext,
  signal,
}: {
  file: File;
  promptContext?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const transcription = await transcribeVoiceInput(file, promptContext, signal);
  return transcription.text;
}

function createVoiceAbortError(): DOMException {
  return new DOMException("Voice transcription was cancelled", "AbortError");
}

export function usePromptVoice(
  promptBoxRef: RefObject<PromptBoxHandle | null>,
  draft?: {
    getCurrent: () => PromptDraftState;
    setDraft: (draft: PromptDraftState) => void;
    submit?: PluginComposerHost["submit"];
  },
): PromptVoiceConfig {
  const pluginSessionRef = useRef<PromptVoiceSession | null>(null);
  const sendPendingRef = useRef(false);
  const stoppedRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onTranscript = useCallback(
    (text: string) => {
      const send = sendPendingRef.current;
      sendPendingRef.current = false;
      stoppedRef.current = false;
      const pluginSession = pluginSessionRef.current;
      const insertWithPlugin = pluginSession
        ? (transcript: string) => pluginSession.insert(transcript)
        : undefined;
      if (mountedRef.current && promptBoxRef.current) {
        if (send && insertWithPlugin) {
          promptBoxRef.current.sendVoiceTranscript(text, insertWithPlugin);
        } else if (send) {
          promptBoxRef.current.sendVoiceTranscript(text);
        } else if (insertWithPlugin) {
          insertWithPlugin(text);
        } else {
          promptBoxRef.current.insertTextAtCursor(text);
        }
        return;
      }
      pluginSession?.end();
      if (!draft) return;
      const current = draft.getCurrent();
      const separator =
        current.text.length > 0 && !/\s$/.test(current.text) ? " " : "";
      draft.setDraft({
        ...current,
        text: `${current.text}${separator}${text}`,
      });
      if (send) return draft.submit?.({ experimental_data: null }, undefined);
    },
    [draft, promptBoxRef],
  );

  const getPromptContext = useCallback(
    () => promptBoxRef.current?.getTextBeforeCursor(),
    [promptBoxRef],
  );

  const transcribeAfterCompletionTransition = useCallback(
    async (args: Parameters<typeof requestVoiceTranscription>[0]) => {
      const pluginSession = pluginSessionRef.current;
      const text = pluginSession
        ? await pluginSession.finish(args.file)
        : await requestVoiceTranscription(args);
      await promptBoxRef.current?.playVoiceCompletionTransition();
      if (args.signal?.aborted) {
        throw createVoiceAbortError();
      }
      return text;
    },
    [promptBoxRef],
  );

  const voiceInput = useVoiceInput({
    onTranscript,
    onTranscribe: transcribeAfterCompletionTransition,
    getPromptContext,
  });

  const { state, readRecording } = voiceInput;
  useEffect(() => {
    if (state === "transcribing") return;
    if (state === "recording") {
      if (pluginSessionRef.current) return;
      const promptContext = promptBoxRef.current?.getTextBeforeCursor();
      pluginSessionRef.current =
        promptBoxRef.current?.beginPluginVoiceInput({
          readRecording,
          transcribe: (file, signal) =>
            requestVoiceTranscription({ file, promptContext, signal }),
        }) ?? null;
      return;
    }
    pluginSessionRef.current?.end();
    pluginSessionRef.current = null;
  }, [promptBoxRef, readRecording, state]);
  useEffect(
    () => () => {
      pluginSessionRef.current?.end();
      pluginSessionRef.current = null;
    },
    [],
  );

  const stop = useCallback(() => {
    if (voiceInput.state !== "recording" || stoppedRef.current) return;
    stoppedRef.current = true;
    sendPendingRef.current = false;
    voiceInput.stop();
  }, [voiceInput]);
  const send = useCallback(() => {
    if (voiceInput.state !== "recording" || stoppedRef.current) return;
    stoppedRef.current = true;
    sendPendingRef.current = true;
    voiceInput.stop();
  }, [voiceInput]);
  const cancel = useCallback(() => {
    sendPendingRef.current = false;
    stoppedRef.current = false;
    voiceInput.cancel();
  }, [voiceInput]);
  useEffect(() => {
    if (
      voiceInput.state !== "recording" &&
      voiceInput.state !== "transcribing"
    ) {
      stoppedRef.current = false;
      sendPendingRef.current = false;
    }
  }, [voiceInput.state]);

  return useMemo<PromptVoiceConfig>(
    () => ({
      state: voiceInput.state,
      microphoneWarning: voiceInput.microphoneWarning,
      isSupported: voiceInput.isSupported,
      stream: voiceInput.stream,
      start: voiceInput.start,
      stop,
      send,
      cancel,
    }),
    [
      voiceInput.state,
      voiceInput.microphoneWarning,
      voiceInput.isSupported,
      voiceInput.stream,
      voiceInput.start,
      stop,
      send,
      cancel,
    ],
  );
}
