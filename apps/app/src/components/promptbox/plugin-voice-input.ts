import { useCallback, type RefObject } from "react";
import type { Editor } from "@tiptap/core";
import type { ExperimentalComposerVoiceRecording } from "@get-bb/plugin-sdk";
import type { ResolvedComposerVoiceInput } from "@/lib/plugin-slot-resolvers";
import {
  beginPromptProvisionalText,
  createProvisionalTextHandle,
} from "./editor/prompt-provisional-text-extension";

export interface PromptVoiceSessionInput {
  readRecording(): File;
  transcribe(audio: File, signal: AbortSignal): Promise<string>;
  serviceRunsLocally: boolean;
}

export interface PromptVoiceSession {
  finish(recording: File): Promise<string>;
  insert(text: string): void;
  end(): void;
}

function voiceCancelledError(): DOMException {
  return new DOMException("Voice transcription was cancelled", "AbortError");
}

export function startPluginVoiceSession({
  voiceInput,
  editor,
  input,
  insertAtCaret,
}: {
  voiceInput: ResolvedComposerVoiceInput | null;
  editor: Editor | null;
  input: PromptVoiceSessionInput;
  insertAtCaret(text: string): void;
}): PromptVoiceSession | null {
  if (voiceInput === null) return null;
  const controller = new AbortController();
  let previewLive = editor !== null && !editor.isDestroyed;
  const provisionalText =
    editor !== null && previewLive
      ? createProvisionalTextHandle(beginPromptProvisionalText(editor), {
          onDetached: insertAtCaret,
          onEnd: () => {
            previewLive = false;
          },
        })
      : null;
  const end = () => {
    provisionalText?.cancel();
    controller.abort();
  };

  let recording: ExperimentalComposerVoiceRecording;
  try {
    recording = voiceInput.voiceInput.start({
      readRecording: () => input.readRecording(),
      transcribe: (audio, { signal }) => input.transcribe(audio, signal),
      serviceRunsLocally: input.serviceRunsLocally,
      provisionalText,
      signal: controller.signal,
    });
    if (typeof recording?.finish !== "function") {
      throw new Error("start() must return an object with a finish function");
    }
  } catch (error) {
    console.error(
      `[plugin:${voiceInput.pluginId}] composer voice input "${voiceInput.customizationId}" failed to start`,
      error,
    );
    end();
    return null;
  }

  return {
    finish: (file) =>
      new Promise<string>((resolve, reject) => {
        if (controller.signal.aborted) {
          reject(voiceCancelledError());
          return;
        }
        const onAbort = () => reject(voiceCancelledError());
        controller.signal.addEventListener("abort", onAbort, { once: true });
        Promise.resolve()
          .then(() => recording.finish(file))
          .then(resolve, reject)
          .finally(() =>
            controller.signal.removeEventListener("abort", onAbort),
          );
      }),
    insert(text) {
      if (provisionalText !== null && previewLive) provisionalText.commit(text);
      else insertAtCaret(text);
      end();
    },
    end,
  };
}

export function usePluginVoiceInput(
  editorRef: RefObject<Editor | null>,
  voiceInput: ResolvedComposerVoiceInput | null,
  insertAtCaret: (text: string) => void,
): (input: PromptVoiceSessionInput) => PromptVoiceSession | null {
  return useCallback(
    (input) =>
      startPluginVoiceSession({
        voiceInput,
        editor: editorRef.current,
        input,
        insertAtCaret,
      }),
    [editorRef, insertAtCaret, voiceInput],
  );
}
