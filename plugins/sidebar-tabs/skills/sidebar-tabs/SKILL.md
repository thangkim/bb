---
name: sidebar-tabs
description: Split bb's left sidebar into Projects, Threads, and More tabs, switch tabs from the palette, and the DOM contract another plugin uses to fill the Projects tab.
---

Sidebar Tabs replaces the sidebar navigation rows with three icon-only tabs above the sidebar body. Hover a tab to see its name:

- **Projects** (the checklist icon) shows the My Tasks topbar, status and priority filters, and project list. My Tasks fills this tab; with My Tasks disabled the tab shows a hint instead.
- **Threads** (the chat bubble icon) shows bb's thread list, the same as without the plugin.
- **More** (the `⋯` tab) holds the navigation rows that used to sit above the thread list: New thread, Search threads, Plugins, Skills, and plugin panels such as My Tasks, Linear, and Docs. Rows you hid from the sidebar appear under **Hidden**. **Customize sidebar** opens bb's editor for order and visibility. Cmd/Ctrl-click a row to open it in a split, or drag it out of the sidebar.

The chosen tab is remembered on this device in `localStorage` (`bb-plugin-sidebar-tabs:active-tab`). The left and right arrow keys, Home, and End move between tabs when one has focus.

Installing the plugin makes it the sidebar navigation provider. Switch back under Settings → Appearance → Navigation, or with the CLI:

```sh
bb settings ui set sidebar.navigationProvider navigation/navigation
bb settings ui set sidebar.navigationProvider sidebar-tabs/tabs
```

The plugin adds three commands to the quick palette (Mod+Shift+P) and to Settings → Keyboard. None has a default shortcut.

| Command id                           | Title                           |
| ------------------------------------ | ------------------------------- |
| `plugin:sidebar-tabs/show-projects`  | Sidebar: show Projects tab      |
| `plugin:sidebar-tabs/show-threads`   | Sidebar: show Threads tab       |
| `plugin:sidebar-tabs/show-more`      | Sidebar: show More tab          |

```sh
bb settings keyboard set plugin:sidebar-tabs/show-projects mod+alt+1
```

## How it hooks into bb

bb has no plugin API for sidebar tabs, so the plugin works from the `experimental_sidebarNavigation` slot. On the Projects and More tabs it sets `data-sidebar-tabs-expanded` on the `[data-testid="sidebar-navigation-region"]` element. A stylesheet then grows that region to fill the sidebar and hides the following `[data-sidebar="content"]` thread list. If bb changes that markup, the tabs still render, but the thread list stays visible below them. Disable the plugin to get bb's navigation rows back.

While the Projects tab is selected, it renders an empty `[data-sidebar-tab-panel="projects"]` element. Leaving the tab removes the element, so whatever another plugin rendered into it unmounts and stops fetching. The More tab's rows likewise mount only while More is selected. The plugin dispatches a `bb:sidebar-tab-panels` window event when the element mounts and again after it unmounts. Any plugin can portal its own content into that element from an `experimental_appOverlay`. Wrap the content in `data-bb-plugin-root=""` and `data-bb-plugin="<your plugin id>"` so your plugin's styles apply. My Tasks does this from `plugins/my-tasks/sidebar-tab/projects-tab.tsx`.
