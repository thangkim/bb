import {
  CLOUD_DRAFT_POLICY,
  LOCAL_DRAFT_POLICY,
  type DraftPolicy,
} from "./draft-scheduler.js";

export const PLUGIN_ID = "voice-live-preview";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function fetchDraftPolicy(
  fetchImpl: FetchLike = fetch,
): Promise<DraftPolicy> {
  try {
    const response = await fetchImpl(
      `/api/v1/plugins/${PLUGIN_ID}/rpc/draftCadence`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      },
    );
    if (!response.ok) return CLOUD_DRAFT_POLICY;
    const body: unknown = await response.json();
    const local =
      typeof body === "object" &&
      body !== null &&
      Reflect.get(body, "ok") === true &&
      Reflect.get(Object(Reflect.get(body, "result")), "local") === true;
    return local ? LOCAL_DRAFT_POLICY : CLOUD_DRAFT_POLICY;
  } catch {
    return CLOUD_DRAFT_POLICY;
  }
}
