---
name: pane-splits
description: Split a new-thread composer off the focused pane with keyboard commands, or open one beside it, and rebind those commands from Settings or the bb CLI.
---

Pane Splits adds five commands to the quick palette (Mod+Shift+P) and to Settings → Keyboard. They act on the main area's split layout on wide screens.

| Command id                             | Title                                     | Default shortcut |
| -------------------------------------- | ----------------------------------------- | ---------------- |
| `plugin:pane-splits/split-left`        | Panes: split new thread left              | Alt+A            |
| `plugin:pane-splits/split-right`       | Panes: split new thread right             | Alt+D            |
| `plugin:pane-splits/split-up`          | Panes: split new thread up                | Alt+W            |
| `plugin:pane-splits/split-down`        | Panes: split new thread down              | Alt+S            |
| `plugin:pane-splits/new-thread-beside` | Panes: new thread beside the focused pane | none             |

A split command opens bb's new-thread composer in a new pane on that side of the focused pane, focuses the prompt, and seeds the project and environment from the focused thread. bb has one new-thread composer, so when it is already open in a pane, that pane is focused instead. At the 8-pane maximum the split is refused with the toast "Can't split — 8 panes is the maximum." The split commands are hidden on compact screens and on pages that cannot be shown in a pane, such as Settings.

`new-thread-beside` opens the composer to the right of the focused pane, or focuses it when it is already open. At the pane maximum it replaces the focused pane. On compact screens and pages that cannot be split it navigates to the New thread screen.

Bind or rebind a command in Settings → Keyboard, or with the CLI:

```sh
bb settings keyboard set thread.new disabled
bb settings keyboard set plugin:pane-splits/new-thread-beside mod+shift+o
bb settings keyboard reset plugin:pane-splits/split-left
```

Mod+Shift+O is bb's own New thread shortcut. Settings → Keyboard offers Replace binding when you assign it; from the CLI, clear `thread.new` first as above.
