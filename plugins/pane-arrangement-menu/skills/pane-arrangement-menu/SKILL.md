---
name: pane-arrangement-menu
description: Full Screen, Move pane and Close pane actions in the thread header's "…" menu instead of the Full Screen and Close pane buttons in split pane headers, and the limits of how the plugin drives bb's hidden button.
---

Pane Arrangement Menu hides the Full Screen button (the diagonal arrows icon, labelled Maximize pane in a web browser) and the Close pane button (the × icon) that bb draws in each split pane's thread header. It adds these items to the thread header's "…" menu instead:

| Item                | What it does                                                                  |
| ------------------- | ----------------------------------------------------------------------------- |
| Full Screen         | Maximizes the pane, like the hidden button. Shows its shortcut (default ⇧⌘E). |
| Exit Full Screen    | Shown in place of Full Screen while the pane is maximized.                    |
| Move pane left      | Moves the pane to the left edge of the split.                                 |
| Move pane right     | Moves the pane to the right edge of the split.                                |
| Move pane to top    | Moves the pane to the top of the split.                                       |
| Move pane to bottom | Moves the pane to the bottom of the split.                                    |
| Close pane          | Closes the pane, like the hidden × button.                                    |

The items match the hidden button. In a web browser they say Maximize pane and Restore split. They appear only in the "…" menu of a thread header in a split, where bb would have drawn the button. The Move items are hidden while the pane is maximized. Close pane appears only where bb would have drawn the × button. bb's thread menu items are the same for every thread, so the plugin hides them in other copies of the menu, such as a sidebar row's menu, the phone layout's drawer, or a single-pane thread.

The keyboard command is unchanged: "Toggle focused chat pane size" (`pane.maximize.toggle`, default ⇧⌘E) still maximizes or restores the focused pane. Rebind it with `bb settings keyboard set pane.maximize.toggle <keys>`. "Close focused chat pane" (`pane.close`) still closes the focused pane. You can still move a pane by dragging its title.

bb has no plugin API for maximizing or moving a pane, so the plugin works through the DOM and can break if bb changes its markup:

- A stylesheet hides `[data-thread-header-pane-actions] > button[aria-pressed]`, and Full Screen clicks that hidden button.
- The same stylesheet hides `[data-thread-header-pane-actions] > button[aria-label="Close pane"]`, and Close pane clicks that hidden button.
- Move items open the button's hidden "Pane arrangement" menu with an ArrowDown key event, then click its "Move left/right/top/bottom" entry. The stylesheet keeps that menu invisible. Embedded browser tabs may dim for a moment while it is open.
- The plugin finds the "…" menu's trigger through the menu's `aria-labelledby`, then looks for the hidden button in the same `<header>`. It relabels the Full Screen item and adds the shortcut hint from the button's `aria-label`.

If bb changes this markup, the button comes back or the items stop working or stay hidden. Disable the plugin to get bb's button back: `bb plugin disable pane-arrangement-menu`.
