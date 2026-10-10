import {
  experimental_useSidebarThreads,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { isSideChatShapedThread } from "../../shared/side-chat.js";
import { ThreadLink } from "./thread-link.js";
import { cn } from "@/lib/utils";

const BUSY_STATUSES = new Set(["starting", "active", "stopping"]);

const NO_SIDE_CHATS: readonly PluginSidebarThread[] = [];

export function isBusyThread(thread: PluginSidebarThread): boolean {
  return BUSY_STATUSES.has(thread.status);
}

function isRepliedSideChat(thread: PluginSidebarThread): boolean {
  return (
    thread.sourceThreadId !== null &&
    isSideChatShapedThread({
      originKind: thread.originKind,
      originPluginId: thread.originPluginId,
      visibility: thread.isHidden ? "hidden" : "visible",
    }) &&
    (thread.title !== null || isBusyThread(thread))
  );
}

function sideChatsBySource(
  threads: readonly PluginSidebarThread[],
): ReadonlyMap<string, readonly PluginSidebarThread[]> {
  const bySource = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    if (thread.sourceThreadId === null || !isRepliedSideChat(thread)) continue;
    const siblings = bySource.get(thread.sourceThreadId) ?? [];
    siblings.push(thread);
    bySource.set(thread.sourceThreadId, siblings);
  }
  for (const siblings of bySource.values()) {
    siblings.sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
  }
  return bySource;
}

const sideChatsByThreads = new WeakMap<
  readonly PluginSidebarThread[],
  ReadonlyMap<string, readonly PluginSidebarThread[]>
>();

function useSideChatsByThread(): ReadonlyMap<
  string,
  readonly PluginSidebarThread[]
> {
  const { threads } = experimental_useSidebarThreads();
  let bySource = sideChatsByThreads.get(threads);
  if (bySource === undefined) {
    bySource = sideChatsBySource(threads);
    sideChatsByThreads.set(threads, bySource);
  }
  return bySource;
}

export function SideChatLinks({
  threadId,
  className,
}: {
  threadId: string;
  className?: string;
}) {
  const sideChats = useSideChatsByThread().get(threadId) ?? NO_SIDE_CHATS;
  if (sideChats.length === 0) return null;
  return (
    <div
      data-side-chats={threadId}
      className={cn("flex flex-col gap-0.5 pl-4", className)}
    >
      {sideChats.map((sideChat) => {
        const working = isBusyThread(sideChat);
        return (
          <ThreadLink
            key={sideChat.id}
            threadId={sideChat.id}
            title={sideChat.displayTitle}
            icon="SideChat"
            statusLabel={working ? "Working" : null}
            working={working}
          />
        );
      })}
    </div>
  );
}
