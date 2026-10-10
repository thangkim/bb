import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";

export function useLiveThreadTitle(
  threadId: string,
  storedTitle: string,
): string {
  const { threads } = experimental_useSidebarThreads();
  return (
    threads.find((thread) => thread.id === threadId)?.displayTitle ??
    storedTitle
  );
}
