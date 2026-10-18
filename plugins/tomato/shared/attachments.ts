export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

export function attachmentDownloadUrl(attachmentId: string): string {
  return `/api/v1/plugins/tomato/http/attachments/download?attachmentId=${encodeURIComponent(attachmentId)}`;
}

const MARKDOWN_MIMES = new Set(["text/markdown", "text/x-markdown"]);

export function isMarkdownAttachment(attachment: {
  fileName: string;
  mime: string;
  isImage: boolean;
}): boolean {
  if (attachment.isImage) return false;
  return (
    MARKDOWN_MIMES.has(attachment.mime) ||
    /\.(md|markdown|mdx)$/iu.test(attachment.fileName)
  );
}
