import { useCallback } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";

export function useOpenThreadInSplit(): (threadId: string) => void {
  const navigate = useBbNavigate();
  return useCallback(
    (threadId: string) => navigate.toThread(threadId, { split: true }),
    [navigate],
  );
}
