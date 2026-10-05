import { useCallback, useEffect, useState } from "react";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";

const NEW_THREAD_OPEN_TIMEOUT_MS = 3000;

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

export function useOpenNewThreadInSplit(): (threadId: string) => void {
  const navigate = useBbNavigate();
  const actions = experimental_useSidebarThreadActions();
  const { threads } = experimental_useSidebarThreads();
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);

  useEffect(() => {
    if (pendingThreadId === null) return;
    if (threads.some((thread) => thread.id === pendingThreadId)) {
      actions.open(pendingThreadId, { split: true });
      setPendingThreadId(null);
      return;
    }
    const timer = window.setTimeout(() => {
      navigate.toThread(pendingThreadId);
      setPendingThreadId(null);
    }, NEW_THREAD_OPEN_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [pendingThreadId, threads, actions, navigate]);

  return useCallback((threadId: string) => setPendingThreadId(threadId), []);
}
