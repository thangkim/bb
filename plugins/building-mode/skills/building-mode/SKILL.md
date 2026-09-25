---
name: building-mode
description: Annotate bb's own interface with source-mapped context, read the resolved bb UI feedback, or update saved annotation comments through the plugin RPC.
---

Install the plugin from a bb checkout with `bb plugin install ./plugins/building-mode`, then enable Building Mode in Settings → Plugins.

## Annotating bb itself

Run the **Annotate bb interface** command (default Shift+Option+B on macOS, Shift+Alt+B elsewhere; also in the command palette) to annotate bb's own window. Hover to highlight an element, click it, write a comment, and choose **Add to prompt** (Ctrl+Enter, Command+Enter on macOS). A status pill shows while selection mode is on; Escape or the shortcut again stops it. Mentions go into the composer of the thread in the current route, or the new-thread composer.

Click a numbered pin to edit its comment, including when selection mode is off. Save updates the saved comment; Cancel or Escape discards the edit. Blank comments cannot be saved. Delete in the pin editor removes that pin and its mention from the current unsent prompt. Successful local message submission or queueing clears the pins; failed sends keep them. Switching to another composer clears the pins, and closing or reloading the window removes them. Saved records remain available to previously sent messages.

Rebind or disable the shortcut in Settings → Keyboard, or with the CLI:

```sh
bb settings keyboard set plugin:building-mode/annotate-app alt+shift+x
bb settings keyboard set plugin:building-mode/annotate-app disabled
bb settings keyboard reset plugin:building-mode/annotate-app
```

The command follows the plugin-command defaults: it runs on the main surface and not while a modal is open. Selection mode that is already on keeps working inside dialogs.

## Source locations

The plugin ships a Vite plugin, `plugins/building-mode/vite-source-locations.ts`, that bb's app Vite config loads when the plugin directory is present. It stamps every lowercase JSX element in bb's app and its workspace packages with `data-bb-src="<repo-relative path>:<line>:<column>"` and records where each top-level component, including `memo` and `forwardRef` components, is defined.

- `pnpm dev` (the Vite dev server) always stamps.
- `vite build` stamps only when `VITE_BB_SOURCE_LOCATIONS=1` is set, and then keeps component names through minification. Put `VITE_BB_SOURCE_LOCATIONS=1` in the git-ignored `.env.development.local` at the repository root so `pnpm start:worktree` and `pnpm desktop:worktree`, which load it through `dotenv -c development`, build a stamped app. `pnpm start`, `pnpm desktop`, and release builds carry no stamps unless the variable is set, and their resolved context says so.
- Plugin UI bundles are never stamped. An element rendered by a plugin records the plugin ID instead; its source trail points at the bb slot that mounts the plugin.

Annotations record the nearest stamped location for up to six distinct files, innermost first. The hover label shows the innermost file, so a label without a file name means the element carries no stamps. Paths are relative to the repository root, so they apply in any worktree of the same checkout. Elements rendered through a dynamic tag such as `<Comp>` or a component report the stamp of the nearest stamped ancestor.

React component names come from DOM fibers. In development React, they follow the owner chain: the components whose JSX created the element, rather than every wrapper around it. Production React has no owner chain, so the list falls back to the parent chain. Library wrappers such as Radix `Primitive.*` and `Slot`, `forwardRef(…)` and `memo(…)` wrappers, routes, `*Provider`/`*Context` components, and minified names are skipped. Components with a recorded definition read `Name (path:line:column)`. Components without one, such as nested or library components, have no source, because React 19 stack frames report positions in transformed code.

## Resolved context

Each mention resolves to compact Markdown feedback: a `## bb UI feedback: <route>` header and the viewport, then one numbered entry. The entry's heading lists up to four components, outermost first, then the element kind and label. Below it:

- **Location:** a short readable selector built from ids, `data-testid`, `aria-label`, and the first plain class of up to five elements.
- **Source:** the element's own stamp when it has one; otherwise the innermost component with a recorded definition, plus the next one in another file; otherwise the nearest stamped ancestor. Unstamped builds say that no source was recorded.
- **Rendered by plugin**, when the element sits inside a plugin's UI.
- **Source trail** and **React**, when present.
- **Classes**, other **Attributes**, **Position**, and **Context**: up to 300 characters of visible text from the nearest ancestor that adds text around the element.
- **Feedback:** the comment.

## Updating comments

Prompt mentions use a stable annotation number and a short summary of the innermost component and the element, such as `1. <MarkdownParagraph> paragraph: "Tests and typecheck…"`. Edits update the context resolved when the prompt is sent without inserting another mention. Messages already sent are unchanged.

The plugin exposes `update` through its typed `buildingModeRpcContract` and the generic plugin RPC SDK/CLI. Supply the saved annotation ID and a nonblank comment of up to 4000 characters in a JSON file:

```json
{ "id": "annotation-id", "comment": "Make this button green" }
```

```sh
bb plugin rpc call building-mode update --input-file annotation-update.json --json
```

An unknown ID or invalid comment fails without creating a record. RPC updates change saved context; an already-open pin keeps its local comment until it is edited again.
