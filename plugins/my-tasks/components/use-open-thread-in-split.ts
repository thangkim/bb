import { useCallback } from "react";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";

export function useOpenThreadInSplit(): (threadId: string) => void {
  const navigate = useBbNavigate();
  const actions = experimental_useSidebarThreadActions();
  const { threads } = experimental_useSidebarThreads();
  return useCallback(
    (threadId: string) => {
      if (threads.some((thread) => thread.id === threadId)) {
        actions.open(threadId, { split: true });
      } else {
        navigate.toThread(threadId);
      }
    },
    [actions, navigate, threads],
  );
}
