---
name: pane-collapse
description: Temporarily minimize a thread pane in a split from the thread's "..." menu or Shift+Option+Z, preview and reply to it from its chip in the window title bar, restore it, and the limits of how it hooks into bb's split layout.
---

Pane Collapse adds **Minimize pane** to the thread actions menu (the "..." in a thread header, and a sidebar row's menu) for every thread shown in a split. Minimizing hides that pane and moves focus to the nearest expanded thread pane. The menu item is hidden when there is no split and on the last expanded pane, so a split always keeps one full-size pane.

A minimized thread appears as a chip in the window title bar, between the sidebar toggle and the right panel toggle, with the most recently minimized thread on the left. Each chip shows a chat icon and the thread title. When the thread is attached to a Tomato task or project, the task title (in blue) or the project's color dot and name follow the title. A dot on the icon means the thread is waiting for an approval or an answer. The icon turns blue when the agent has finished a reply you haven't read yet, and goes back to grey once you open the thread. Click a chip, or press Cmd+Ctrl+Z for the leftmost one, to restore the pane and focus its thread. Focusing a minimized pane another way, such as clicking its thread in the sidebar, also restores it.

Hover a chip to open a popover with the thread's latest agent message and a reply box. Enter sends the reply (Shift+Enter adds a new line); it is queued if the agent is still working, and the pane stays minimized. The popover stays open while the reply box has focus, and an unsent draft is kept until the window reloads. A plain reply does not answer a pending approval or question; the popover says so, and its Open button restores the pane so you can respond there.

When bb shows no window title bar (the sidebar is not framed, or on a compact screen), a minimized pane shrinks to a 36px strip instead: a narrow column in a side-by-side split, a short bar in a stacked one, with the same icon, dot, title and linked task or project. Click the strip to restore it.

Minimizing is temporary: the thread keeps running and its pane stays in the layout. Minimized panes are remembered only while the app window stays open, and a pane that is closed or leaves the split is forgotten. A maximized pane shows normally even if it was minimized.

The plugin also adds three commands to the quick palette (Mod+Shift+P) and to Settings → Keyboard, where you can rebind them.

| Command id                              | Title                                        | Default shortcut |
| --------------------------------------- | -------------------------------------------- | ---------------- |
| `plugin:pane-collapse/collapse-focused` | Panes: minimize focused pane                 | Shift+Option+Z   |
| `plugin:pane-collapse/restore-latest`   | Panes: restore most recently minimized pane  | Cmd+Ctrl+Z       |
| `plugin:pane-collapse/expand-all`       | Panes: restore minimized panes               | none             |

Rebind one with the CLI:

```sh
bb settings keyboard set plugin:pane-collapse/collapse-focused mod+alt+m
```

The other panes in the same row or column grow to fill the space a minimized pane gives up, keeping their relative sizes. A pane whose size another plugin pins, such as Tomato keeping the width you dragged it to, keeps that size, and the remaining panes fill around it. bb has no plugin API for pane sizes or the title bar, so the plugin relies on bb's markup. It marks the affected `[data-split-resize-grid-root]` split grids with a `data-pane-collapse-root` attribute and overrides their cells' flex sizes with a stylesheet. With the title bar, it hides the minimized cells and the dividers they leave doubled. It inserts the chip row (`data-pane-collapse-tray`) as the second child of `[data-testid="app-window-title-bar"]`, and mounts strips inside the `[data-split-pane-id]` pane element. It re-reads bb's sizes whenever a divider drag changes them. If bb changes that markup, minimizing stops hiding or shrinking the pane, or the chips move or fall back to strips; disable the plugin to get bb's behavior back. The chips and strips read the linked task or project from the element in the pane carrying `data-linked-work-kind` (`task` or `project`), `data-linked-work-label`, and optional `data-linked-work-color`; any plugin can set those attributes on its thread header badge to appear there.
