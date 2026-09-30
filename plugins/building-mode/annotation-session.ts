import { useCallback, useEffect, useRef, useState } from "react";
import {
  useComposer,
  useRpc,
  type PluginComposerScope,
} from "@get-bb/plugin-sdk/app";
import {
  ANNOTATION_MENTION_PROVIDER_ID,
  annotationMentionLabel,
  formatAnnotationContext,
  pageMessageSchema,
  pageStateSchema,
  type AnnotationRecord,
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

const NOTICE_DURATION_MS = 5000;

const COMPOSER_SELECTORS: Partial<Record<PluginComposerScope["kind"], string>> =
  {
    thread: "#thread-detail-follow-up-composer",
    "new-thread": "#root-compose-prompt",
  };

function composerOnPage(scope: PluginComposerScope): boolean {
  const selector = COMPOSER_SELECTORS[scope.kind];
  return selector === undefined || document.querySelector(selector) !== null;
}

async function copyToClipboard(text: Promise<string>): Promise<void> {
  if (typeof ClipboardItem === "undefined") {
    await navigator.clipboard.writeText(await text);
    return;
  }
  const item = new ClipboardItem({
    "text/plain": text.then(
      (value) => new Blob([value], { type: "text/plain" }),
    ),
  });
  await navigator.clipboard
    .write([item])
    .catch(async () => navigator.clipboard.writeText(await text));
}

export function useAnnotationSession(target: AnnotationTarget) {
  const composer = useComposer();
  const rpc = useRpc<typeof buildingModeRpcContract>();
  const composerRef = useRef(composer);
  const pendingSaves = useRef(Promise.resolve());
  composerRef.current = composer;
  const [state, setState] = useState<PageState>(INACTIVE_STATE);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (notice === null) return;
    const timeout = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [notice]);

  const applyState = useCallback((value: unknown) => {
    const parsed = pageStateSchema.safeParse(value);
    setState(parsed.success ? parsed.data : INACTIVE_STATE);
  }, []);

  const readRecord = useCallback(
    async (annotation: PageAnnotation): Promise<AnnotationRecord> => ({
      ...annotation,
      components: await target.readComponents(annotation.id),
    }),
    [target],
  );

  const saveAnnotation = useCallback(
    async (record: Promise<AnnotationRecord>, copied: Promise<void> | null) => {
      const resolved = await record;
      const saved = await rpc.call("save", resolved);
      if (copied !== null) {
        await copied;
        setNotice(
          "No prompt box here, so the feedback was copied. Paste it into a thread.",
        );
        return;
      }
      composerRef.current.insertMention({
        provider: ANNOTATION_MENTION_PROVIDER_ID,
        id: saved.id,
        label: annotationMentionLabel(resolved),
      });
    },
    [rpc],
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
        const record =
          message.type === "annotation" ? readRecord(message.annotation) : null;
        const copied =
          record !== null && !composerOnPage(composerRef.current.scope)
            ? copyToClipboard(record.then(formatAnnotationContext))
            : null;
        copied?.catch(() => undefined);
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
            } else if (record !== null) {
              await saveAnnotation(record, copied);
            }
            setError(null);
          })
          .catch((cause: unknown) => {
            setError(errorMessage(cause));
          });
      }),
    [readRecord, rpc, saveAnnotation, target],
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
    setNotice(null);
    const result = state.active
      ? target.control("deactivate")
      : target.activate(readTheme());
    result.then(applyState, (cause: unknown) => {
      setError(errorMessage(cause));
    });
  }, [applyState, state.active, target]);

  return { state, error, notice, toggle, clear, scope: composer.scope };
}
