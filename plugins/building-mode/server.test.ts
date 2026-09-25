import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { AnnotationRecord } from "./annotations.js";
import plugin from "./server.js";

const record: AnnotationRecord = {
  id: "mfx12abc",
  number: 1,
  comment: "Make this green",
  url: "http://127.0.0.1:26846/projects/proj_1/threads/thr_1",
  title: "bb",
  viewport: { width: 1280, height: 720 },
  element: {
    tagName: "button",
    name: 'button#send "Send"',
    selector: "#send",
    text: "Send",
    attributes: { id: "send" },
    rect: { x: 40, y: 300, width: 120, height: 36 },
    context: "",
    sources: ["apps/app/src/Composer.tsx:12:5"],
    pluginId: null,
  },
  components: [
    { name: "SendButton", source: "apps/app/src/SendButton.tsx:12:8" },
  ],
};

async function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "building-mode" });
  await plugin(bb);
  const provider = harness.registrations.mentionProviders.find(
    (candidate) => candidate.id === "bb-ui-annotation",
  );
  if (provider === undefined) {
    throw new Error("Expected the bb UI annotation mention provider.");
  }
  return { bb, harness, provider };
}

describe("building mode server", () => {
  it("stores saved annotations and resolves them as bb UI feedback", async () => {
    const { harness, provider } = await setup();

    const { id } = z
      .object({ id: z.string().min(1) })
      .parse(await harness.callRpc("save", record));
    expect(id).toBe(record.id);
    await harness.callRpc("update", { id, comment: "Make this blue" });
    const resolved = await provider.resolve(id);

    expect(resolved.context).toContain(
      "## bb UI feedback: /projects/proj_1/threads/thr_1",
    );
    expect(resolved.context).toContain("**Feedback:** Make this blue");
    expect(resolved.context).not.toContain("Make this green");
    expect(resolved.context).toContain(
      "**Source trail:** `apps/app/src/Composer.tsx:12:5`",
    );
    await expect(provider.resolve("missing")).rejects.toThrow(
      "This bb UI annotation is no longer available",
    );
  });

  it("rejects updates to missing annotations and blank edits", async () => {
    const { harness } = await setup();
    await expect(
      harness.callRpc("update", { id: "missing", comment: "Updated" }),
    ).rejects.toThrow();
    await harness.callRpc("save", record);
    await expect(
      harness.callRpc("update", { id: record.id, comment: " " }),
    ).rejects.toThrow();
  });

  it("rejects malformed annotations at the rpc boundary", async () => {
    const { harness } = await setup();

    await expect(
      harness.callRpc("save", { ...record, comment: "   " }),
    ).rejects.toThrow();
    const { pluginId: _pluginId, ...element } = record.element;
    await expect(
      harness.callRpc("save", { ...record, element }),
    ).rejects.toThrow();
  });
});
