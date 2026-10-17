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
