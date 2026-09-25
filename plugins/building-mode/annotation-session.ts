import { useCallback, useEffect, useRef, useState } from "react";
import { useComposer, useRpc } from "@get-bb/plugin-sdk/app";
import {
  ANNOTATION_MENTION_PROVIDER_ID,
  annotationMentionLabel,
  pageMessageSchema,
  pageStateSchema,
  type PageAnnotation,
  type PageState,
  type ReactComponent,
} from "./annotations.js";
import { THEME_TOKENS } from "./page-script.js";
import type { buildingModeRpcContract } from "./server.js";

export type AnnotationControl = "deactivate" | "state" | "clear";

export interface AnnotationTarget {
  activate(theme: Record<string, string>): Promise<unknown>;
  control(method: AnnotationControl): Promise<unknown>;
  onMessage(listener: (data: unknown) => void): () => void;
  readComponents(annotationId: string): Promise<ReactComponent[]>;
  release(): void;
}

export const INACTIVE_STATE: PageState = { active: false, count: 0 };

function readTheme(): Record<string, string> {
  const computed = getComputedStyle(document.documentElement);
  const theme: Record<string, string> = {};
  for (const token of THEME_TOKENS) {
    const value = computed.getPropertyValue(`--${token}`).trim();
    if (value.length > 0) {
      theme[`--bb-${token}`] = value;
    }
  }
  return theme;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function useAnnotationSession(target: AnnotationTarget) {
  const composer = useComposer();
  const rpc = useRpc<typeof buildingModeRpcContract>();
  const composerRef = useRef(composer);
  const pendingSaves = useRef(Promise.resolve());
  composerRef.current = composer;
  const [state, setState] = useState<PageState>(INACTIVE_STATE);
  const [error, setError] = useState<string | null>(null);

  const applyState = useCallback((value: unknown) => {
    const parsed = pageStateSchema.safeParse(value);
    setState(parsed.success ? parsed.data : INACTIVE_STATE);
  }, []);

  const addToPrompt = useCallback(
    async (annotation: PageAnnotation) => {
      const record = {
        ...annotation,
        components: await target.readComponents(annotation.id),
      };
      const saved = await rpc.call("save", record);
      composerRef.current.insertMention({
        provider: ANNOTATION_MENTION_PROVIDER_ID,
        id: saved.id,
        label: annotationMentionLabel(record),
      });
    },
    [rpc, target],
  );

  useEffect(
    () =>
      target.onMessage((data) => {
        const parsed = pageMessageSchema.safeParse(data);
        if (!parsed.success) {
          return;
        }
        if (parsed.data.type === "state") {
          setState({ active: parsed.data.active, count: parsed.data.count });
          return;
        }
        const message = parsed.data;
        pendingSaves.current = pendingSaves.current
          .then(async () => {
            if (message.type === "annotation-delete") {
              composerRef.current.experimental_removeMention({
                provider: ANNOTATION_MENTION_PROVIDER_ID,
                id: message.id,
              });
            } else if (message.type === "annotation-update") {
              await rpc.call("update", {
                id: message.id,
                comment: message.comment,
              });
            } else {
              await addToPrompt(message.annotation);
            }
            setError(null);
          })
          .catch((cause: unknown) => {
            setError(errorMessage(cause));
          });
      }),
    [addToPrompt, rpc, target],
  );

  useEffect(() => {
    target.control("state").then(applyState, () => setState(INACTIVE_STATE));
  }, [applyState, target]);

  useEffect(() => () => target.release(), [target]);

  const clear = useCallback(async () => {
    applyState(await target.control("clear"));
  }, [applyState, target]);

  useEffect(
    () =>
      composer.experimental_onSubmitted(() => {
        pendingSaves.current = pendingSaves.current
          .then(clear)
          .catch((cause: unknown) => setError(errorMessage(cause)));
      }),
    // oxlint-disable-next-line react/exhaustive-deps
    [composer.experimental_onSubmitted, clear],
  );

  const toggle = useCallback(() => {
    setError(null);
    const result = state.active
      ? target.control("deactivate")
      : target.activate(readTheme());
    result.then(applyState, (cause: unknown) => {
      setError(errorMessage(cause));
    });
  }, [applyState, state.active, target]);

  return { state, error, toggle, clear, scope: composer.scope };
}
