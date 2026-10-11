import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const voiceLivePreviewRpcContract = defineRpcContract({
  draftCadence: {
    input: z.null(),
    output: z.object({ local: z.boolean() }).strict(),
  },
});
