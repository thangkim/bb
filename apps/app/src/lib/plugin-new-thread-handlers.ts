import { useEffect, useLayoutEffect, useRef } from "react";
import type {
  ExperimentalNewThreadHandler,
  ExperimentalNewThreadRequest,
} from "@get-bb/plugin-sdk";

interface HandlerEntry {
  current: ExperimentalNewThreadHandler | null;
}

const handlerEntries: HandlerEntry[] = [];

export function offerNewThreadRequest(
  request: ExperimentalNewThreadRequest,
): boolean {
  for (const entry of [...handlerEntries]) {
    const handler = entry.current;
    if (handler === null) continue;
    try {
      if (handler(request)) return true;
    } catch (error) {
      console.error("Plugin new-thread handler failed", error);
    }
  }
  return false;
}

export function useNewThreadHandler(
  handler: ExperimentalNewThreadHandler | null,
): void {
  const entryRef = useRef<HandlerEntry>({ current: handler });
  useLayoutEffect(() => {
    entryRef.current.current = handler;
  }, [handler]);
  useEffect(() => {
    const entry = entryRef.current;
    handlerEntries.push(entry);
    return () => {
      const index = handlerEntries.indexOf(entry);
      if (index !== -1) handlerEntries.splice(index, 1);
    };
  }, []);
}
