export const SIDE_CHAT_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "side-chat",
  "side-chat-plus",
]);

interface SideChatShapeThread {
  originKind: string | null;
  originPluginId: string | null;
  visibility: string;
}

export function isSideChatShapedThread(thread: SideChatShapeThread): boolean {
  return (
    thread.originKind === "fork" &&
    thread.originPluginId !== null &&
    SIDE_CHAT_PLUGIN_IDS.has(thread.originPluginId) &&
    thread.visibility === "hidden"
  );
}

const BUSY_THREAD_STATUSES: ReadonlySet<string> = new Set([
  "starting",
  "active",
  "stopping",
]);

export function isBusyThreadStatus(status: string): boolean {
  return BUSY_THREAD_STATUSES.has(status);
}

interface UsedSideChatThread extends SideChatShapeThread {
  title: string | null;
  titleFallback: string | null;
  status: string;
}

export function isUsedSideChat(thread: UsedSideChatThread): boolean {
  return (
    isSideChatShapedThread(thread) &&
    (thread.title !== null ||
      thread.titleFallback !== null ||
      isBusyThreadStatus(thread.status))
  );
}
