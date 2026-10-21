import type {
  ExperimentalPluginFixedTabReference,
  JsonValue,
} from "@get-bb/plugin-sdk/app";

export type AttachmentPreviewTarget = {
  attachmentId: string;
  fileName: string;
  sizeBytes: number;
};

function isAttachmentPreviewTarget(
  value: JsonValue,
): value is AttachmentPreviewTarget {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return (
    typeof value.attachmentId === "string" &&
    value.attachmentId.length > 0 &&
    typeof value.fileName === "string" &&
    typeof value.sizeBytes === "number" &&
    Number.isFinite(value.sizeBytes)
  );
}

export const ATTACHMENT_PREVIEW_TAB = {
  panelId: "tasks",
  id: "preview",
  experimental_target: { validate: isAttachmentPreviewTarget },
} satisfies ExperimentalPluginFixedTabReference<AttachmentPreviewTarget>;
