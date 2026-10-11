import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { voiceLivePreviewRpcContract } from "./contract.js";
import {
  CLOUD_DRAFT_POLICY,
  LOCAL_DRAFT_POLICY,
  type DraftPolicy,
} from "./draft-scheduler.js";

export type VoiceLivePreviewRpc = PluginRpcClient<
  typeof voiceLivePreviewRpcContract
>;

export async function fetchDraftPolicy(
  rpc: VoiceLivePreviewRpc,
): Promise<DraftPolicy> {
  try {
    const { local } = await rpc.call("draftCadence");
    return local ? LOCAL_DRAFT_POLICY : CLOUD_DRAFT_POLICY;
  } catch {
    return CLOUD_DRAFT_POLICY;
  }
}
