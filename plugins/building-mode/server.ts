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
});

export default async function plugin(bb: BbPluginApi) {
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
  });
  bb.ui.registerMentionProvider({
    id: ANNOTATION_MENTION_PROVIDER_ID,
    label: "bb UI annotations",
    search: () => [],
    async resolve(id) {
      const parsed = annotationRecordSchema.safeParse(
        await bb.storage.kv.get(`${STORAGE_PREFIX}${id}`),
      );
      if (!parsed.success) {
        throw new Error("This bb UI annotation is no longer available");
      }
      return { context: formatAnnotationContext(parsed.data) };
    },
  });
}
