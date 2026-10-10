import { useCallback } from "react";
import {
  experimental_useSidebarThreads,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";

export function useOpenThreadInSplit(): (threadId: string) => void {
  const navigate = useBbNavigate();
  const { threads } = experimental_useSidebarThreads();
  return useCallback(
    (threadId: string) => {
      if (threads.some((thread) => thread.id === threadId)) {
        navigate.toThread(threadId, { split: true });
      } else {
        navigate.toThread(threadId);
      }
    },
    [navigate, threads],
  );
}
