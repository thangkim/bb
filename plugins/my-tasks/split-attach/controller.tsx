import { useEffect, useRef } from "react";
import {
  useBbContext,
  useRpc,
  useSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";
import type { DelegationRpcContract } from "../delegate/contract.js";
import { errorMessage } from "../shared/errors.js";
import {
  advanceSplitTracker,
  seedSplitTracker,
  type SplitTrackerState,
} from "./tracker.js";

export function SplitAttachController() {
  const layout = useSidebarSplitLayout();
  const { threadId } = useBbContext();
  const rpc = useRpc<DelegationRpcContract>();
  const tracker = useRef<SplitTrackerState | null>(null);

  useEffect(() => {
    if (tracker.current === null) {
      tracker.current = seedSplitTracker(layout, threadId);
      return;
    }
    const { state, requests } = advanceSplitTracker(
      tracker.current,
      layout,
      threadId,
      Date.now(),
    );
    tracker.current = state;
    for (const request of requests) {
      rpc.call("threadSplitAttach", request).catch((error: unknown) => {
        console.warn(`My Tasks split attach failed: ${errorMessage(error)}`);
      });
    }
  }, [layout, threadId, rpc]);

  return null;
}
