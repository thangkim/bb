import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { transcribeVoiceInput } from "@/lib/api";
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
): PromptVoiceConfig {
  const pluginSessionRef = useRef<PromptVoiceSession | null>(null);
  const serviceRunsLocally =
    useSystemConfig().data?.voiceTranscriptionRunsLocally ?? false;
  const onTranscript = useCallback(
    (text: string) => {
      const pluginSession = pluginSessionRef.current;
      if (pluginSession) pluginSession.insert(text);
      else promptBoxRef.current?.insertTextAtCursor(text);
    },
    [promptBoxRef],
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
          serviceRunsLocally,
        }) ?? null;
      return;
    }
    pluginSessionRef.current?.end();
    pluginSessionRef.current = null;
  }, [promptBoxRef, readRecording, serviceRunsLocally, state]);
  useEffect(
    () => () => {
      pluginSessionRef.current?.end();
      pluginSessionRef.current = null;
    },
    [],
  );

  return useMemo<PromptVoiceConfig>(
    () => ({
      state: voiceInput.state,
      isSupported: voiceInput.isSupported,
      stream: voiceInput.stream,
      start: voiceInput.start,
      stop: voiceInput.stop,
      cancel: voiceInput.cancel,
    }),
    [
      voiceInput.state,
      voiceInput.isSupported,
      voiceInput.stream,
      voiceInput.start,
      voiceInput.stop,
      voiceInput.cancel,
    ],
  );
}
