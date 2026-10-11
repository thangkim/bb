---
name: image-copy
description: "Explain or diagnose the Image copy plugin, which copies images as PNG from a right-click menu or the open image preview with Cmd/Ctrl+C."
---

# Image copy

## Right-click menu

Right-clicking any loaded image in the app opens a small plugin menu in place
of the native one:

- **Copy Image** copies the image to the clipboard as PNG and shows an "Image
  copied" toast ("Failed to copy image" on failure).
- **Copy Link** appears when the image is inside a link and copies the link
  URL, as the native desktop menu does.
- **Copy** appears when text was selected when the menu opened and copies that
  text as plain text.

Arrow keys, Home, and End move through the items; Enter or Space runs one.
Escape, Tab, scrolling, resizing, switching windows, or clicking outside closes
the menu. An outside click only closes the menu; it does not reach the page.

The native menu still opens with **Shift**+right-click, and on images that
have not finished loading, images inside editable content, touch or pen
long-presses, and anything bb already shows its own context menu for. Use
Shift+right-click for native entries the plugin menu does not offer, such as
"Save Image As" in a browser.

## Image preview shortcut

While bb's full-screen image preview is open, **Cmd+C** (macOS) or **Ctrl+C**
copies the previewed image to the clipboard as PNG, shows an "Image copied"
toast, and closes the preview. A failure shows "Failed to copy image".

The shortcut is ignored with Shift or Alt held, on key repeat, while text is
selected (native copy runs instead), while focus is in an editable element,
and while the preview is still loading its image.

## Setup and troubleshooting

The plugin has no settings, commands, or agent tools. Install it with
`bb plugin install ./plugins/image-copy` and toggle it with
`bb plugin enable|disable image-copy`.

Both paths fetch the image URL and re-encode non-PNG images through a canvas.
When copying fails, check that the page has clipboard permission (browsers
require a secure context and a user gesture) and that the image URL is
reachable from the app. Images from other origins that do not allow
cross-origin requests cannot be fetched, so copying them fails. The preview
shortcut finds the preview by its `Close image preview` button inside a modal
dialog; a bb release that renames that control needs a plugin update.
