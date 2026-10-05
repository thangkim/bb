import { useCallback, useEffect, useRef, useState } from "react";
import type { ComposerDraftSnapshot } from "@get-bb/plugin-sdk";
import {
  useComposer,
  useRpc,
  type PluginComposerScope,
} from "@get-bb/plugin-sdk/app";
import {
  ANNOTATION_MENTION_PROVIDER_ID,
  annotationMentionLabel,
  formatAnnotationContext,
  formatAnnotationsContext,
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

function withoutAnnotationMention(
  draft: ComposerDraftSnapshot,
  id: string,
): ComposerDraftSnapshot {
  const removed = draft.mentions
    .filter(
      (mention) =>
        mention.kind === "plugin" &&
        mention.provider === ANNOTATION_MENTION_PROVIDER_ID &&
        mention.id === id,
    )
    .sort((a, b) => a.from - b.from);
  if (removed.length === 0) return draft;
  let text = "";
  let cursor = 0;
  for (const mention of removed) {
    text += draft.text.slice(cursor, mention.from);
    cursor = mention.to;
  }
  const removedSet = new Set(removed);
  const mentions = draft.mentions
    .filter((mention) => !removedSet.has(mention))
    .map((mention) => {
      const offset = removed.reduce(
        (sum, item) =>
          sum + (item.to <= mention.from ? item.to - item.from : 0),
        0,
      );
      return offset === 0
        ? mention
        : { ...mention, from: mention.from - offset, to: mention.to - offset };
    });
  return { ...draft, text: text + draft.text.slice(cursor), mentions };
}

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
  const records = useRef(new Map<string, AnnotationRecord>());
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
      const current = composerRef.current;
      const separator =
        current.text.length === 0 || /\s$/u.test(current.text) ? "" : " ";
      current.insert(
        [
          separator,
          {
            provider: ANNOTATION_MENTION_PROVIDER_ID,
            id: saved.id,
            label: annotationMentionLabel(resolved),
          },
          " ",
        ],
        { at: "end" },
      );
      current.focus();
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
        if (message.type === "annotation-copy") {
          const ready = message.annotations.flatMap(({ id, comment }) => {
            const saved = records.current.get(id);
            return saved === undefined ? [] : [{ ...saved, comment }];
          });
          if (ready.length === 0) {
            setError("These annotations are not ready to copy yet.");
            return;
          }
          copyToClipboard(
            Promise.resolve(formatAnnotationsContext(ready)),
          ).then(
            () => {
              setError(null);
              setNotice(
                ready.length === 1
                  ? `Copied feedback #${ready[0]?.number}.`
                  : `Copied ${ready.length} feedback prompts.`,
              );
            },
            (cause: unknown) => setError(errorMessage(cause)),
          );
          return;
        }
        const record =
          message.type === "annotation" ? readRecord(message.annotation) : null;
        record?.then(
          (resolved) => records.current.set(resolved.id, resolved),
          () => undefined,
        );
        const copied =
          record !== null && !composerOnPage(composerRef.current.scope)
            ? copyToClipboard(record.then(formatAnnotationContext))
            : null;
        copied?.catch(() => undefined);
        pendingSaves.current = pendingSaves.current
          .then(async () => {
            if (message.type === "annotation-delete") {
              records.current.delete(message.id);
              composerRef.current.replace((current) =>
                withoutAnnotationMention(current, message.id),
              );
            } else if (message.type === "annotation-update") {
              const saved = records.current.get(message.id);
              if (saved !== undefined) {
                records.current.set(message.id, {
                  ...saved,
                  comment: message.comment,
                });
              }
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
    records.current.clear();
    applyState(await target.control("clear"));
  }, [applyState, target]);

  useEffect(
    () =>
      composer.onSubmitted(() => {
        pendingSaves.current = pendingSaves.current
          .then(clear)
          .catch((cause: unknown) => setError(errorMessage(cause)));
      }),
    // oxlint-disable-next-line react/exhaustive-deps
    [composer.onSubmitted, clear],
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
