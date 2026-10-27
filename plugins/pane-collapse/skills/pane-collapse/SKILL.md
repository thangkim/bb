---
name: pane-collapse
description: Temporarily minimize a thread pane in a split from the thread's "..." menu or Shift+Option+Z, preview and reply to it from its chip in the window title bar, restore it, and the limits of how it hooks into bb's split layout.
---

Pane Collapse adds **Minimize pane** to the thread actions menu (the "..." in a thread header, and a sidebar row's menu) for every thread shown in a split. Minimizing hides that pane and moves focus to the nearest expanded thread pane. The menu item is hidden when there is no split and on the last expanded pane, so a split always keeps one full-size pane.

A minimized thread appears as a chip in the window title bar, between the sidebar toggle and the right panel toggle, with the most recently minimized thread on the left. Each chip shows a chat icon and the thread title. When the thread is attached to a Tomato task or project, the task title (in blue) or the project's color dot and name follow the title. A dot on the icon means the thread is waiting for an approval or an answer. The icon turns blue when the agent has finished a reply you haven't read yet, and goes back to grey once you open the thread. Click a chip, or press Cmd+Ctrl+Z for the leftmost one, to restore the pane and focus its thread. Focusing a minimized pane another way, such as clicking its thread in the sidebar, also restores it.

Hover a chip to open a popover with the thread's latest agent message and a reply box. Enter sends the reply (Shift+Enter adds a new line); it is queued if the agent is still working, and the pane stays minimized. The popover stays open while the reply box has focus, and an unsent draft is kept until the window reloads. A plain reply does not answer a pending approval or question; the popover says so, and its Open button restores the pane so you can respond there.

The **Show minimized threads as** setting (Settings → Plugins → Pane Collapse) chooses where minimized threads go. `Chips in the title bar` is the default. `Vertical strips on the left` gathers every minimized thread into a row of 36px vertical strips, with the most recently minimized thread leftmost. The strips sit directly after a leading non-thread pane such as Tomato, or at the left edge of the split when there is none. Each strip shows the same icon, dot, title and linked task or project as a chip, and clicking it restores the pane. Hovering a strip opens the same popover as a chip (latest messages, reply box, context ring, Open button) to its right. The rail is a child of the outermost split row (`data-pane-collapse-rail`), so it relies on bb's markup; dragging the divider just before it still resizes the panes on either side. If the outermost split is stacked, the rail goes to its left instead, and if it can't be placed at all, minimized panes fall back to in-place strips. `Horizontal strips on top` puts the same strips in one full-width bar (`data-pane-collapse-bar`) above the thread area instead, again with the most recently minimized thread leftmost and the same hover popover below each strip. The bar is inserted before the outermost split root in its parent, and a stylesheet switches that parent (`data-pane-collapse-bar-host`) to a column and lets the split fill the remaining height, so it relies on that parent being a plain flex container.

When bb shows no window title bar (the sidebar is not framed, or on a compact screen) and chips are selected, a minimized pane shrinks to a 36px strip instead: a narrow column in a side-by-side split, a short bar in a stacked one, with the same icon, dot, title and linked task or project. Click the strip to restore it.

Minimizing is temporary: the thread keeps running and its pane stays in the layout. Minimized panes stay minimized when you refresh or reload the app window, and a pane that is closed or leaves the split is forgotten. A maximized pane shows normally even if it was minimized.

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
