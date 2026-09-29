import { describe, expect, it, vi } from "vitest";
import { fetchDraftPolicy } from "./draft-cadence.js";
import { CLOUD_DRAFT_POLICY, LOCAL_DRAFT_POLICY } from "./draft-scheduler.js";

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("fetchDraftPolicy", () => {
  it("asks the plugin's own rpc and drafts every second for a local service", async () => {
    const fetchImpl = respond(200, { ok: true, result: { local: true } });

    await expect(fetchDraftPolicy(fetchImpl)).resolves.toBe(LOCAL_DRAFT_POLICY);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/plugins/voice-live-preview/rpc/draftCadence",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      },
    );
  });

  it("falls back to the cloud schedule when the answer is not local or the call fails", async () => {
    await expect(
      fetchDraftPolicy(respond(200, { ok: true, result: { local: false } })),
    ).resolves.toBe(CLOUD_DRAFT_POLICY);
    await expect(
      fetchDraftPolicy(respond(500, { ok: false, error: "boom" })),
    ).resolves.toBe(CLOUD_DRAFT_POLICY);
    await expect(
      fetchDraftPolicy(async () => {
        throw new TypeError("network down");
      }),
    ).resolves.toBe(CLOUD_DRAFT_POLICY);
  });
});
