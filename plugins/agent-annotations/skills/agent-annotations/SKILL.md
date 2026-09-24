---
name: agent-annotations
description: Create or edit element annotations in desktop Browser tabs or on bb's own interface, read their source-mapped context, or update saved annotation comments through the plugin RPC.
---

Enable Agent Annotations in Settings → Plugins. In a desktop Browser tab, activate Annotate elements, select an element, and add its comment to the prompt. Click a numbered pin to edit its comment, including when selection mode is off. Save or Ctrl+Enter (Command+Enter on macOS) updates the saved comment; Cancel or Escape discards the edit. Blank comments cannot be saved. Delete in the pin editor removes that pin and its reference from the current unsent prompt. Successful local message submission or queueing clears the page annotations; failed sends keep them. Pins also disappear when the page navigates or reloads. Saved records remain available to previously sent messages.

## Annotating bb itself

Run the **Annotate bb interface** command (default Shift+Option+B on macOS, Shift+Alt+B elsewhere; also in the command palette) to annotate bb's own window with the same hover, comment, and pin flow. A status pill shows while selection mode is on; Escape or the shortcut again stops it. Mentions go into the composer of the thread in the current route, or the new-thread composer. Switching to another composer clears the pins, and closing or reloading the window removes them.

Rebind or disable the shortcut in Settings → Keyboard, or with the CLI:

```sh
bb settings keyboard set plugin:agent-annotations/annotate-app alt+shift+x
bb settings keyboard set plugin:agent-annotations/annotate-app disabled
bb settings keyboard reset plugin:agent-annotations/annotate-app
```

The command follows the plugin-command defaults: it runs on the main surface and not while a modal is open. Selection mode that is already on keeps working inside dialogs.

## Source locations

`pnpm dev`, `pnpm start:worktree`, and `pnpm desktop:worktree` stamp every lowercase JSX element with `data-bb-src="<repo-relative path>:<line>:<column>"`. This covers bb's app and the UIs of builtin plugins; under `pnpm dev` it also covers path-installed plugins inside the checkout. Stamped builds keep component names through minification. `pnpm start`, `pnpm desktop`, release builds, and plugins outside the checkout carry no stamps, and their resolved context says so. When the dev server starts, it rebuilds plugin bundles whose stamping doesn't match the current mode. Annotations record the nearest stamped location for up to six distinct files, innermost first, as `Source` in the resolved context. The hover label shows the innermost file, so a label without a file name means the element carries no stamps. Paths are relative to the repository root, so they apply in any worktree of the same checkout. Elements rendered through a dynamic tag such as `<Comp>` or a component report the stamp of the nearest stamped ancestor.

React component names come from DOM fibers. In development React, they follow the owner chain: the components whose JSX created the element, rather than every wrapper around it. Production React has no owner chain, so the list falls back to the parent chain. Library wrappers such as Radix `Primitive.*` and `Slot`, `forwardRef(…)` and `memo(…)` wrappers, routes, `*Provider`/`*Context` components, and minified names are skipped. Stamped bb builds also record where each top-level component in the app, shared packages, and stamped plugin UIs is defined, including `memo` and `forwardRef` components, so each entry reads `Name (path:line:column)`. Plugin UIs detect top-level declarations that start at column 0, which holds for formatted code. Components without a recorded definition, such as nested or library components, have no source on bb's own interface, because React 19 stack frames report positions in transformed code. Browser tabs that load a `pnpm dev` bb also get the stamped sources.

## Updating comments

Prompt mentions use a stable annotation number and element description. Edits update the context resolved when the prompt is sent without inserting another mention. Messages already sent are unchanged.

The plugin exposes `update` through its typed `agentAnnotationsRpcContract` and the generic plugin RPC SDK/CLI. Supply the saved annotation ID and a nonblank comment of up to 4000 characters in a JSON file:

```json
{ "id": "annotation-id", "comment": "Make this button green" }
```

```sh
bb plugin rpc call agent-annotations update --input-file annotation-update.json --json
```

An unknown ID or invalid comment fails without creating a record. RPC updates change saved context; an already-open page pin keeps its local comment until it is edited again.
