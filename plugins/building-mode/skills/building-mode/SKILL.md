---
name: building-mode
description: Annotate bb's own interface with source-mapped context, preview or read the resolved bb UI feedback behind a mention pill, or update saved annotation comments through the plugin RPC.
---

Install the plugin from a bb checkout with `bb plugin install ./plugins/building-mode`, then enable Building Mode in Settings → Plugins.

## Annotating bb itself

Run the **Annotate bb interface** command (default Shift+Option+B on macOS, Shift+Alt+B elsewhere; also in the command palette) to annotate bb's own window. Hover to highlight an element, click it, write a comment, and choose **Add to prompt** (Ctrl+Enter, Command+Enter on macOS). A status pill shows while selection mode is on; Escape or the shortcut again stops it. Mentions go into the composer of the thread in the current route, or the new-thread composer; when neither composer is on the page, the full feedback is copied to the clipboard instead. Pills are labelled `#1 …` so they keep their context when copied into another thread's composer.

Click a numbered pin to edit its comment, including when selection mode is off. Save updates the saved comment; Cancel or Escape discards the edit. Blank comments cannot be saved. Delete in the pin editor removes that pin and its mention from the current unsent prompt. **Copy prompt** in the pin editor, or the **Copy all annotation prompts** command (default Control+C, including on macOS), copies every pin's full feedback as one text prompt, in pin order and with any unsaved edit in the open editor, for pasting into another AI chat. Successful local message submission or queueing clears the pins; failed sends keep them. Switching to another composer clears the pins, and closing or reloading the window removes them. Saved records remain available to previously sent messages.

Rebind or disable either shortcut in Settings → Keyboard, or with the CLI:

```sh
bb settings keyboard set plugin:building-mode/annotate-app alt+shift+x
bb settings keyboard set plugin:building-mode/annotate-app disabled
bb settings keyboard reset plugin:building-mode/annotate-app
bb settings keyboard set plugin:building-mode/copy-annotation-prompt ctrl+shift+c
```

The copy command is available whenever there is at least one pin. Both commands follow the plugin-command defaults: they run on the main surface and not while a modal is open. Selection mode that is already on keeps working inside dialogs.

## Source locations

Stamped builds tag every lowercase JSX element with `data-bb-src="<repo-relative path>:<line>:<column>"`, record where each top-level component (including `memo` and `forwardRef` components) is defined, and keep component names through minification. The stamping code lives in this plugin: `vite-source-locations.ts` for bb's app, which the app Vite config loads when the plugin directory is present, and `esbuild-source-locations.ts` for plugin UI bundles, which `@bb/plugin-build` loads when `VITE_BB_SOURCE_LOCATIONS=1` and the plugin being built sits inside a checkout that contains this plugin.

- bb's app: the Vite dev server (`pnpm dev`) always stamps. `vite build` stamps only with `VITE_BB_SOURCE_LOCATIONS=1`.
- Plugin UIs (thread-list, sidebar, and every other plugin slot, plus path-installed plugins inside the checkout): stamped only with `VITE_BB_SOURCE_LOCATIONS=1`, under `pnpm dev`, `pnpm start:worktree`, and `pnpm desktop:worktree`. When the flag changes, the server rebuilds dev and path-installed plugin bundles on their next load, and Turbo keys bundled-plugin builds on the flag. Plugins outside the checkout are never stamped.
- Put `VITE_BB_SOURCE_LOCATIONS=1` in the git-ignored `.env.development.local` at the repository root. `pnpm dev`, `pnpm start:worktree`, and `pnpm desktop:worktree` load it through `dotenv -c development`. `pnpm start`, `pnpm desktop`, and release builds carry no stamps unless the variable is set, and their resolved context says so.
- Turbo does not track edits to the stamping files themselves; after changing them, rebuild with `--force`.

Annotations record the nearest stamped location for up to six distinct files, innermost first. The hover label shows the innermost file, so a label without a file name means the element carries no stamps. Paths are relative to the repository root, so they apply in any worktree of the same checkout. Elements rendered through a dynamic tag such as `<Comp>` or a component report the stamp of the nearest stamped ancestor.

React component names come from DOM fibers. In development React, they follow the owner chain: the components whose JSX created the element, rather than every wrapper around it. Production React has no owner chain, so the list falls back to the parent chain. Library wrappers such as Radix `Primitive.*` and `Slot`, `forwardRef(…)` and `memo(…)` wrappers, routes, `*Provider`/`*Context` components, and minified names are skipped. Components with a recorded definition read `Name (path:line:column)`. Components without one, such as nested or library components, have no source, because React 19 stack frames report positions in transformed code.

## Resolved context

Each mention resolves to compact Markdown feedback: a `## bb UI feedback: <route>` header and the viewport, then one numbered entry. The entry's heading lists up to four components, outermost first, then the element kind and label. Below it:

- **Location:** a short readable selector built from ids, `data-testid`, `aria-label`, and the first plain class of up to five elements.
- **Source:** the element's own stamp when it has one; otherwise the innermost component with a recorded definition, plus the next one in another file; otherwise the nearest stamped ancestor. Unstamped builds say that no source was recorded.
- **Rendered by plugin**, the ID of the plugin whose UI slot contains the element, when there is one.
- **Source trail** and **React**, when present.
- **Classes**, other **Attributes**, **Position**, and **Context**: up to 300 characters of visible text from the nearest ancestor that adds text around the element.
- **Feedback:** the comment.

## Previewing a mention

Pill labels are truncated. Rest the pointer on a Building Mode pill for about a third of a second, in the composer or in a sent message, to open a popover with the full context that pill sends: the same Markdown described under **Resolved context**, with the current comment. The popover opens above the pill when there is room, otherwise below; long prompts scroll inside it. Moving the pointer into the popover keeps it open; leaving both the pill and the popover, pressing a key, or pressing outside it closes it. Pressing inside it does not move focus out of the composer. A pill whose saved record is gone says the annotation is no longer available. Other mention pills are unaffected.

Read the same text without the UI through the `preview` RPC, which returns `{ "context": string | null }` (`null` for an unknown ID):

```sh
echo '{ "id": "annotation-id" }' > annotation-preview.json
bb plugin rpc call building-mode preview --input-file annotation-preview.json --json
```

The popover finds pills through the host's rendered mention markup (`.prompt-mention-pill` and its `data-prompt-mention-resource` JSON), which is not a public plugin API, so a host markup change can silently disable it without affecting sending.

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
