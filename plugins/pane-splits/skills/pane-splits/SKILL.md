---
name: pane-splits
description: Open bb's new-thread composer to the right of the focused pane or reopen the last closed thread pane with keyboard commands, and rebind those commands from Settings or the bb CLI.
---

Pane Splits adds two commands to the quick palette (Mod+Shift+P) and to Settings → Keyboard. They act on the main area's split layout on wide screens.

| Command id                         | Title                          | Default shortcut |
| ---------------------------------- | ------------------------------ | ---------------- |
| `plugin:pane-splits/split-right`   | Panes: new thread on the right | Alt+D            |
| `plugin:pane-splits/reopen-closed` | Panes: reopen closed thread    | Mod+Alt+T        |

`split-right` opens bb's New thread composer in a new pane to the right of the focused pane, exactly as Cmd/Ctrl-clicking New thread in bb's sidebar does, and works with the sidebar collapsed. bb has one composer pane: when it is already open, the command focuses that pane instead of opening another. At the 8-pane maximum, bb puts the composer in place of the focused pane. The composer then switches to the focused thread's project, as Mod+Shift+O does, and focuses its prompt. On compact screens and pages that cannot be split, it opens the New thread screen in place. bb's own New thread buttons and Mod+Shift+O (`thread.new`) are not changed by the plugin.

A thread created in a pane split off a thread inherits that thread's side panel tabs once its first message is sent: file previews, diffs, plugin panels, and browser tabs (as a separate view of the same URL that navigates independently) are added in the same order ahead of the new thread's own tabs. Terminals, side chats, and unsaved New tab pages are not copied. Alt+D preselects the focused thread's environment in the composer (bb's composer only runs browser tabs when it reuses an environment; pick another environment before sending to change it), and also gives the composer the focused thread's side panel (open or closed, same tabs and active tab, browser tabs at their current URL), so the panel does not collapse when focus moves to the composer; this replaces whatever the new-thread composer's panel showed before. If the source thread's side panel was open, the new thread's panel opens too, on its copy of the source's active tab (or its first tab when the active one is not copied); browser tabs start at the source tab's current URL. The copy happens once, so later navigation in either thread does not affect the other. Opening an existing thread in the split pane copies nothing. See and edit a thread's tab list with `bb thread tabs show|set`.

`reopen-closed` reopens the thread from the most recently closed pane, in a new pane on the side of the focused pane where it was closed, like reopening a closed browser tab. Repeat it to walk back through up to 20 closes. Threads already open in a pane are skipped. Closes are remembered only while the app window stays open, and only panes that held a thread count: closing a composer or plugin panel pane is not recorded. Minimized panes do not count toward the cap. At the pane cap it toasts "Can't split — 8 panes is the maximum." and keeps the thread for later; with nothing left it toasts "No closed thread to reopen." On compact screens the thread opens in place. The command opens the thread the way `bb thread open <id> --split <side>` does, so every bb window connected to the server opens it, not only the one you pressed the shortcut in. Mod+Shift+T stays with bb's `panel.reopenClosedTab`, which reopens side-panel tabs.

Bind or rebind a command in Settings → Keyboard, or with the CLI:

```sh
bb settings keyboard set plugin:pane-splits/split-right mod+alt+n
bb settings keyboard reset plugin:pane-splits/reopen-closed
```
