---
name: image-copy
description: "Explain or diagnose the Image copy plugin, which copies the open image preview with Cmd/Ctrl+C."
---

# Image copy

While bb's full-screen image preview is open, **Cmd+C** (macOS) or **Ctrl+C**
copies the previewed image to the clipboard as PNG, shows an "Image copied"
toast, and closes the preview. Images in other formats are re-encoded to PNG
through a canvas first. A failure shows "Failed to copy image".

The shortcut is ignored with Shift or Alt held, on key repeat, while text is
selected (native copy runs instead), while focus is in an editable element,
and while the preview is still loading its image.

The plugin has no settings, commands, or agent tools. Install it with
`bb plugin install ./plugins/image-copy` and toggle it with
`bb plugin enable|disable image-copy`.

When copying fails, check that the page has clipboard permission (browsers
require a secure context and a user gesture) and that the image URL is
reachable from the app. The plugin finds the preview by its
`Close image preview` button inside a modal dialog; a bb release that renames
that control needs a plugin update.
