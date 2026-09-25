import { toast } from "sonner";

export const LIGHTBOX_CLOSE_BUTTON_SELECTOR =
  'button[aria-label="Close image preview"]';

interface OpenLightbox {
  image: HTMLImageElement;
  closeButton: HTMLButtonElement;
}

export function findOpenLightbox(): OpenLightbox | null {
  const closeButtons = document.querySelectorAll<HTMLButtonElement>(
    LIGHTBOX_CLOSE_BUTTON_SELECTOR,
  );
  for (let index = closeButtons.length - 1; index >= 0; index -= 1) {
    const closeButton = closeButtons[index]!;
    const dialog = closeButton.parentElement;
    if (
      dialog === null ||
      dialog.getAttribute("role") !== "dialog" ||
      dialog.getAttribute("aria-modal") !== "true"
    ) {
      continue;
    }
    const image = Array.from(dialog.children).find(
      (child): child is HTMLImageElement => child instanceof HTMLImageElement,
    );
    if (image === undefined) return null;
    return { image, closeButton };
  }
  return null;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  return (
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}

function isCopyShortcut(event: KeyboardEvent): boolean {
  return (
    !event.defaultPrevented &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !event.repeat &&
    event.key.toLowerCase() === "c"
  );
}

function hasTextSelection(): boolean {
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed;
}

export async function convertImageBlobToPng(blob: Blob): Promise<Blob> {
  if (blob.type.toLowerCase() === "image/png") {
    return blob;
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = document.createElement("img");
    image.src = objectUrl;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("The browser cannot convert the clipboard image");
    }
    context.drawImage(image, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((pngBlob) => {
        if (pngBlob) {
          resolve(pngBlob);
          return;
        }
        reject(new Error("The browser cannot encode the clipboard image"));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function fetchPng(imageUrl: string): Promise<Blob> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(
      `The clipboard image request failed with ${response.status}`,
    );
  }
  return convertImageBlobToPng(await response.blob());
}

export async function copyImageToClipboard(imageUrl: string): Promise<boolean> {
  if (
    typeof navigator.clipboard?.write !== "function" ||
    typeof ClipboardItem === "undefined"
  ) {
    return false;
  }
  try {
    const png = fetchPng(imageUrl);
    void png.catch(() => undefined);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch {
    return false;
  }
}

async function copyImageWithToast(imageUrl: string): Promise<void> {
  if (await copyImageToClipboard(imageUrl)) {
    toast.success("Image copied");
    return;
  }
  toast.error("Failed to copy image");
}

export function mountImageCopy(signal: AbortSignal): () => void {
  if (signal.aborted) return () => {};

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isCopyShortcut(event) || isEditableKeyboardTarget(event.target)) {
      return;
    }
    if (hasTextSelection()) return;
    const lightbox = findOpenLightbox();
    if (lightbox === null) return;
    const imageUrl = lightbox.image.currentSrc || lightbox.image.src;
    if (imageUrl.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void copyImageWithToast(imageUrl);
    lightbox.closeButton.click();
  };

  const dispose = () => {
    signal.removeEventListener("abort", dispose);
    window.removeEventListener("keydown", onKeyDown, true);
  };

  window.addEventListener("keydown", onKeyDown, true);
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
