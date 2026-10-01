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

A split command opens a new composer in a new pane on that side of the focused pane and focuses its prompt. The composer starts on the focused thread's project and environment, or on the focused composer's project. Every composer pane keeps its own project, environment, section, and prompt draft, so splitting twice gives two independent composers. At the 8-pane maximum the split is refused with the toast "Can't split — 8 panes is the maximum." The split commands are hidden on compact screens and on pages that cannot be shown in a pane, such as Settings.

`new-thread-beside` does nothing but focus the prompt when the focused pane is already a composer, and focuses an open composer for the same project and environment. Otherwise it opens a composer to the right of the focused pane, or, at the pane maximum, in place of the focused pane. On compact screens and pages that cannot be split it navigates to the New thread screen.

bb's own New thread affordances follow the same rule while the plugin is enabled: the sidebar's New thread item, the New thread buttons on projects, sections, and environments, Mod+Shift+O (`thread.new`), and New thread in environment. Instead of replacing the thread on screen, they open a composer to the right of the focused pane for the clicked project, section, or environment, or focus the focused composer when it is already on that project. On compact screens and pages that cannot be split, bb opens the New thread screen as usual. Disable the plugin to get the replacing behavior back.

Bind or rebind a command in Settings → Keyboard, or with the CLI:

```sh
bb settings keyboard set plugin:pane-splits/new-thread-beside mod+alt+n
bb settings keyboard reset plugin:pane-splits/split-left
```
