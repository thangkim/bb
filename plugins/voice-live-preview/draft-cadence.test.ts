import { describe, expect, it, vi } from "vitest";
import { fetchDraftPolicy, type VoiceLivePreviewRpc } from "./draft-cadence.js";
import { CLOUD_DRAFT_POLICY, LOCAL_DRAFT_POLICY } from "./draft-scheduler.js";

function rpcAnswering(answer: () => Promise<{ local: boolean }>) {
  const call = vi.fn(answer);
  const rpc: VoiceLivePreviewRpc = { call };
  return { rpc, call };
}

describe("fetchDraftPolicy", () => {
  it("asks the plugin's own rpc and drafts every second for a local service", async () => {
    const { rpc, call } = rpcAnswering(async () => ({ local: true }));

    await expect(fetchDraftPolicy(rpc)).resolves.toBe(LOCAL_DRAFT_POLICY);
    expect(call).toHaveBeenCalledWith("draftCadence");
  });

  it("falls back to the cloud schedule when the answer is not local or the call fails", async () => {
    await expect(
      fetchDraftPolicy(rpcAnswering(async () => ({ local: false })).rpc),
    ).resolves.toBe(CLOUD_DRAFT_POLICY);
    await expect(
      fetchDraftPolicy(
        rpcAnswering(async () => {
          throw new TypeError("network down");
        }).rpc,
      ),
    ).resolves.toBe(CLOUD_DRAFT_POLICY);
  });
});
