import { useEffect } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { isBusyThreadStatus } from "../../shared/side-chat.js";
import { useTasksQuery } from "../../shell/data.js";
import { ThreadLink } from "./thread-link.js";
import { cn } from "@/lib/utils";

const SIDE_CHAT_REFRESH_MS = 10_000;

export function isBusyThread(thread: PluginSidebarThread): boolean {
  return isBusyThreadStatus(thread.status);
}

function useSideChats(threadId: string) {
  const query = useTasksQuery(
    async (rpc) => (await rpc.call("listSideChats", { threadId })).sideChats,
    ["threads:changed"],
    [threadId],
  );
  const { refresh } = query;
  useEffect(() => {
    const timer = setInterval(refresh, SIDE_CHAT_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  return query.data;
}

export function SideChatLinks({
  threadId,
  className,
}: {
  threadId: string;
  className?: string;
}) {
  const sideChats = useSideChats(threadId);
  if (sideChats === undefined || sideChats.length === 0) return null;
  return (
    <div
      data-side-chats={threadId}
      className={cn("flex flex-col gap-0.5 pl-4", className)}
    >
      {sideChats.map((sideChat) => {
        const working = isBusyThreadStatus(sideChat.status);
        return (
          <ThreadLink
            key={sideChat.id}
            threadId={sideChat.id}
            title={sideChat.title}
            icon="SideChat"
            statusLabel={working ? "Working" : null}
            working={working}
          />
        );
      })}
    </div>
  );
}
