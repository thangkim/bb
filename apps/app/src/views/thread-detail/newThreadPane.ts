import type { QueryClient } from "@tanstack/react-query";
import type { ThreadResponse } from "@bb/server-contract";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import {
  countPanes,
  findPane,
  listPanes,
  MAX_PANES,
  replacePaneContent,
  setFocus,
  splitPane,
  type ComposeSeed,
  type PaneContent,
  type PaneNode,
  type SplitLayout,
} from "@/lib/split-layout";

let composeIdCounter = 0;

export function nextComposeId(): string {
  composeIdCounter += 1;
  return `compose-${Date.now().toString(36)}-${composeIdCounter}`;
}

export function composeSeedForPaneContent(
  content: PaneContent,
  queryClient: QueryClient,
): ComposeSeed | null {
  if (content.kind === "new-thread") return content.seed ?? null;
  if (content.kind !== "thread") return null;
  const thread = queryClient.getQueryData<ThreadResponse>(
    threadQueryKey(content.threadId),
  );
  const environmentId = thread?.environmentId ?? null;
  return {
    projectId: content.projectId,
    ...(environmentId === null ? {} : { environmentId }),
  };
}

export function createNewThreadPaneContent(seed: ComposeSeed): PaneContent {
  return { kind: "new-thread", composeId: nextComposeId(), seed };
}

function isComposerForSeed(pane: PaneNode, seed: ComposeSeed): boolean {
  const content = pane.content;
  return (
    content.kind === "new-thread" &&
    content.seed?.projectId === seed.projectId &&
    content.seed.environmentId === seed.environmentId
  );
}

export function openNewThreadBesideFocusedPane(
  layout: SplitLayout,
  seed: ComposeSeed,
  { reuseFocusedComposer }: { reuseFocusedComposer: boolean },
): SplitLayout {
  const focused = findPane(layout.root, layout.focusedPaneId);
  if (reuseFocusedComposer && focused?.content.kind === "new-thread") {
    return layout;
  }
  const existing = listPanes(layout.root).find((pane) =>
    isComposerForSeed(pane, seed),
  );
  if (existing !== undefined) return setFocus(layout, existing.paneId);
  const content = createNewThreadPaneContent(seed);
  return countPanes(layout.root) >= MAX_PANES
    ? replacePaneContent(layout, layout.focusedPaneId, content)
    : splitPane(layout, layout.focusedPaneId, "right", content);
}
