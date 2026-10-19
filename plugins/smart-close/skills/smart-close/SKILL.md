---
name: smart-close
description: "Explain or diagnose the Smart close plugin, which makes Cmd+W close the active right-panel tab when the right panel is active and the focused thread pane otherwise."
---

# Smart close

Cmd+W (Ctrl+W off macOS) closes what you are working in:

- **Right panel active**: bb's own **Close panel tab** runs. It closes the
  active browser, terminal, file, or plugin tab, or the panel itself on Diff
  and Info.
- **Anywhere else**: bb's **Close focused chat pane** runs. With only one pane
  open, Cmd+W does nothing.

The right panel is active after you click inside it or move keyboard focus
into it. It stays active while you keep pressing Cmd+W to close tabs, and stops
being active when you click or tab elsewhere or the panel closes. A focused
embedded browser page always counts as the right panel.

## Required shortcuts

The plugin relies on bb's own shortcuts:

- **Close panel tab** (`panel.close`) on Cmd+W, bb's default. bb's desktop menu
  uses this binding, and it is the only way Cmd+W reaches bb while an embedded
  browser page has focus.
- **Close focused chat pane** (`pane.close`) on Cmd+Shift+X, bb's default. The
  plugin presses this shortcut for you.

Restore them with `bb settings keyboard reset panel.close` and
`bb settings keyboard reset pane.close`, and check them with
`bb settings keyboard list`.

The plugin has no settings, commands, or agent tools. Install it with
`bb plugin install ./plugins/smart-close` and toggle it with
`bb plugin enable|disable smart-close`.

## Diagnosing

- Cmd+W closes a panel tab while you are in the conversation: the plugin is
  disabled, or the right panel was the last thing clicked.
- Cmd+W does nothing outside the panel: only one pane is open, or `pane.close`
  is no longer on Cmd+Shift+X.
- Cmd+W never closes panel tabs: `panel.close` is no longer on Cmd+W.

The plugin finds the right panel as the `<aside>` that contains bb's
`Right panel views` toolbar. A bb release that changes that markup needs a
plugin update.
