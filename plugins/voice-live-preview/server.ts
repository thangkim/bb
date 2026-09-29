import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const DEFAULT_LOCAL_VOICE_SERVICES = "local-whisper/local-whisper";

const SERVICE_REFERENCE = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/u;

export const voiceLivePreviewRpcContract = defineRpcContract({
  draftCadence: {
    input: z.null(),
    output: z.object({ local: z.boolean() }).strict(),
  },
});

export type VoiceSelection =
  | { mode: "automatic" }
  | { mode: "off" }
  | { mode: "service"; pluginId: string; serviceId: string };

export function parseLocalVoiceServices(value: string): string[] | null {
  const references = value
    .split(",")
    .map((reference) => reference.trim())
    .filter((reference) => reference.length > 0);
  return references.every((reference) => SERVICE_REFERENCE.test(reference))
    ? references
    : null;
}

export function isLocalVoiceSelection(
  selection: VoiceSelection,
  localServices: readonly string[],
): boolean {
  return (
    selection.mode === "service" &&
    localServices.includes(`${selection.pluginId}/${selection.serviceId}`)
  );
}

export default function voiceLivePreviewPlugin(bb: BbPluginApi): void {
  const settings = bb.settings.define({
    localVoiceServices: {
      type: "string",
      label: "Voice services that run on this machine",
      description:
        "Comma-separated plugin-id/service-id pairs. When one of them is selected in Settings → AI services → Voice input, drafts are free, so the live preview updates every second instead of at growing intervals.",
      default: DEFAULT_LOCAL_VOICE_SERVICES,
      experimental_schema: z
        .string()
        .refine(
          (value) => parseLocalVoiceServices(value) !== null,
          "Use comma-separated plugin-id/service-id pairs, such as local-whisper/local-whisper",
        ),
    },
  });

  bb.rpc.register(voiceLivePreviewRpcContract, {
    async draftCadence() {
      const [{ selections }, values] = await Promise.all([
        bb.sdk.system.aiServices(),
        settings.get(),
      ]);
      return {
        local: isLocalVoiceSelection(
          selections.voice,
          parseLocalVoiceServices(values.localVoiceServices) ?? [],
        ),
      };
    },
  });
}
