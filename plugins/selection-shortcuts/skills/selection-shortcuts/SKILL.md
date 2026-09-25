---
name: selection-shortcuts
description: "Explain or diagnose the Selection shortcuts plugin, which adds A and R keys to bb's text-selection menu."
---

# Selection shortcuts

This plugin adds single-key shortcuts to the menu that appears when you select
text in a thread timeline, file preview, diff, or terminal.

- **A** runs **Add to chat**.
- **R** runs **Reply in side chat** (only when the Side chat plugin adds that
  action).

Each shortcut button shows its key as a hint and exposes it through
`aria-keyshortcuts`. Keys are ignored while Meta, Ctrl, or Alt is held, on key
repeat, during IME composition, and while focus is in an input, textarea,
select, or contenteditable element; the hints hide in that case too. A shortcut
clicks the real menu button, so the action, menu dismissal, and selection
clearing behave exactly as a click.

The plugin has no settings, commands, or agent tools. Install it with
`bb plugin install ./plugins/selection-shortcuts` and toggle it with
`bb plugin enable|disable selection-shortcuts`.

When a shortcut does nothing, confirm the plugin is enabled with
`bb plugin list`, that the selection menu is open, and that focus is not in an
editable field. The plugin finds the menu by bb's Radix popover markup and the
button labels above; a bb release that renames those labels needs a plugin
update.
