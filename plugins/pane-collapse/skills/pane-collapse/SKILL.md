---
name: pane-collapse
description: Temporarily collapse a thread pane in a split to a narrow chat strip from its header or a command, expand it again, and the limits of how it hooks into bb's split layout.
---

Pane Collapse adds a Collapse pane button (a minus icon) to the thread header of every pane in a split. Clicking it shrinks that pane to a 36px strip with a chat icon and the thread title, and moves focus to the nearest expanded thread pane. The strip sits on the same side as the pane did: a narrow column in a side-by-side split, a short bar in a stacked one. A dot on the chat icon means the thread is waiting for an approval or an answer.

Click the strip to expand the pane again. Focusing a collapsed pane another way, such as clicking its thread in the sidebar, also expands it. The button is hidden when there is no split and on the last expanded pane, so a split always keeps one full-size pane.

Collapsing is temporary: the thread keeps running and its pane stays in the layout. Collapsed panes are remembered only while the app window stays open, and a pane that is closed or leaves the split is forgotten. A maximized pane shows normally even if it was collapsed.

The plugin also adds two commands to the quick palette (Mod+Shift+P) and to Settings → Keyboard. Neither has a default shortcut.

| Command id                              | Title                          |
| --------------------------------------- | ------------------------------ |
| `plugin:pane-collapse/collapse-focused` | Panes: collapse focused pane   |
| `plugin:pane-collapse/expand-all`       | Panes: expand collapsed panes  |

Bind one with the CLI:

```sh
bb settings keyboard set plugin:pane-collapse/collapse-focused mod+alt+m
```

bb has no plugin API for pane sizes, so the plugin sizes a collapsed pane with a stylesheet that targets bb's split markup (`[data-split-resize-grid-root]` cells holding `[data-split-pane-id]` panes) and mounts the strip inside the pane element. If bb changes that markup, collapsing stops shrinking the pane; disable the plugin to get bb's behavior back. Dragging a divider next to a collapsed pane resizes the others but not the strip.
