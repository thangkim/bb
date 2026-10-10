import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  ANNOTATION_MENTION_PROVIDER_ID,
  annotationRecordSchema,
  annotationUpdateSchema,
  formatAnnotationContext,
} from "./annotations.js";

const STORAGE_PREFIX = "annotation:";

export const buildingModeRpcContract = defineRpcContract({
  update: {
    input: annotationUpdateSchema,
    output: z.object({ id: z.string() }).strict(),
  },
  save: {
    input: annotationRecordSchema,
    output: z.object({ id: z.string() }).strict(),
  },
  preview: {
    input: z.object({ id: z.string().min(1).max(64) }).strict(),
    output: z.object({ context: z.string().nullable() }).strict(),
  },
});

export default async function plugin(bb: BbPluginApi) {
  async function readContext(id: string): Promise<string | null> {
    const parsed = annotationRecordSchema.safeParse(
      await bb.storage.kv.get(`${STORAGE_PREFIX}${id}`),
    );
    return parsed.success ? formatAnnotationContext(parsed.data) : null;
  }
  bb.rpc.register(buildingModeRpcContract, {
    async update({ id, comment }) {
      const record = annotationRecordSchema.parse(
        await bb.storage.kv.get(`${STORAGE_PREFIX}${id}`),
      );
      await bb.storage.kv.set(`${STORAGE_PREFIX}${id}`, { ...record, comment });
      return { id };
    },
    async save(annotation) {
      await bb.storage.kv.set(`${STORAGE_PREFIX}${annotation.id}`, annotation);
      return { id: annotation.id };
    },
    async preview({ id }) {
      return { context: await readContext(id) };
    },
  });
  bb.ui.registerMentionProvider({
    id: ANNOTATION_MENTION_PROVIDER_ID,
    label: "bb UI annotations",
    search: () => [],
    async resolve(id) {
      const context = await readContext(id);
      if (context === null) {
        throw new Error("This bb UI annotation is no longer available");
      }
      return { context };
    },
  });
}
