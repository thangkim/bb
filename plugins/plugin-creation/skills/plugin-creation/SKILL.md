---
name: plugin-creation
description: "Required rules for any bb plugin work in the bb repository (the user's fork of get-bb/bb, in any checkout or worktree): check existing and community plugins first, never change bb core, keep plugins fast, scalable, and correct. Load this BEFORE reading or editing code whenever the user asks to build, create, make, write, add, update, change, extend, fix, refactor, or remove a bb plugin, or asks for any behavior inside a named bb plugin (\"do X in plugin Z\", \"add X to my-tasks\", \"make attention-alerts do Y\", \"the focused-diff plugin should Z\"). Also load it when the user asks for a new bb feature, UI tweak, shortcut, command, or agent tool that would be built as a plugin, or when the task touches files under the bb repo's plugins/ directory. Not for plugins of other projects or frameworks."
---

# Plugin creation

This fork (`fork/plugins`, pushed to the `thangkim` remote) carries the user's
bb customizations as plugins on top of upstream bb (`origin/main`). The user
merges upstream regularly. Every change outside a plugin the user owns becomes
a merge conflict later, and every slow or leaky plugin slows the bb they use
all day, on desktop and on their phone.

This skill ships in `plugins/plugin-creation` so every thread gets it, in any
checkout or worktree. Edit it there.

Use `bb-plugin-authoring` for SDK mechanics. This skill sets the user's rules,
and it overrides that skill where they disagree: here you do not add Plugin
SDK surfaces.

## 1. Classify the change

List official plugins with `git ls-tree --name-only origin/main plugins/`.
Every other directory under `plugins/` is the user's.

- **New plugin or new feature**: go to step 2.
- **Change to one of the user's plugins**: go to step 3.
- **Change to an official plugin**: do not edit it in place. Build the change
  as a separate plugin (replacement slot, additional slot, or a fork of the
  official plugin under a new name with the original disabled). Edits to
  official plugins conflicted on the October 2026 upstream merge
  (`thread-list`, `bb-guide`, `plugin-api-docs`).
- **Needs bb core** (`apps/`, `packages/`, `docs/`, root config): stop and
  follow step 3's "No supported API" path.

## 2. Look for an existing plugin first

Before writing code, search in this order:

1. `bb plugin list`: installed plugins, including disabled ones.
2. `ls plugins/` and each candidate's `package.json` `bb.description`: bundled
   and the user's own plugins.
3. `bb plugin search <query>` with at least three queries: the feature name,
   synonyms, and the UI surface (for example `diff`, `changed files`,
   `review`). Search ranking is loose and returns unrelated themes, so read the
   descriptions instead of trusting the order. Only the `bb-community`
   marketplace is reviewed by BB.

Report what you searched and what you found, then:

- **Exact match**: recommend installing or configuring it. Do not build.
- **Partial match**: present options (use it, extend the user's own plugin,
  build new) and let the user choose before you write code.
- **No match**: say so, list the queries, and build.

Build a new plugin for an unrelated purpose instead of growing an existing one;
the user wants each plugin to do one thing.

## 3. Stay inside the plugin

Every file you change must live in `plugins/<name>/` for a plugin the user
owns, or in `.bb/skills/`. Nothing else.

**No supported API.** If the SDK cannot do what is needed, stop and give the
user these options with their costs:

1. Reach the goal with existing surfaces (slots, `useSdk`, `useBbNavigate`,
   commands, agent tools, content scripts, realtime, RPC).
2. A DOM-level workaround through a content script. Fragile: it breaks silently
   when bb markup changes. Name the selectors in the plugin's skill and cover
   them with a test.
3. Propose the API upstream as a PR to `get-bb/bb`, then use it once merged.
4. Drop or reduce the feature.

Never add the API to `packages/plugin-sdk` or `apps/` yourself. The fork's
earlier SDK additions caused 25 conflicted core files when 275 upstream
commits were merged in October 2026.

Some of the user's plugins depend on fork-only SDK APIs from that earlier
work. Do not add new uses of them; prefer the upstream equivalent when one
exists.

**Check before finishing:**

```sh
git diff --name-only HEAD
git status --short
```

Every path must be under `plugins/<user-plugin>/` or `.bb/skills/`. The one
exception is the `pnpm-lock.yaml` importer entry for that plugin, written by
`pnpm install` run outside the sandbox (inside it, pnpm asks to purge every
`node_modules` and writes nothing). Anything else is a violation: revert it or
ask the user.

## 4. Performance: cost to bb when the plugin is idle

The plugin runs inside the user's bb all the time, so its idle cost matters
more than its peak cost.

- Do no heavy work at module load or registration. Load large dependencies
  with dynamic `import()` when the feature is first used.
- Prefer realtime events and RPC over polling. If you must poll, stop while the
  document is hidden or the surface is unmounted, and use intervals of seconds,
  not milliseconds.
- Register global listeners (`keydown`, `resize`, `MutationObserver`) once,
  scope them to the narrowest root, and dispose them. Never observe
  `document.body` with `subtree: true` without a narrower target.
- Slot components render inside sidebars, thread rows, and composers that
  re-render often. Subscribe narrowly (one thread, not the whole thread list),
  memoize derived data, and keep props stable.
- Bound every cache and every map keyed by thread or project id. Prune entries
  when the thread closes.
- On the server, use targeted `WHERE`/`JOIN` queries with indexes that match
  them, paginate lists with a hard limit, avoid N+1 lookups across threads,
  and return bounded CLI and agent-tool output.
- On the host, never block on synchronous fs or exec in hot paths, and kill
  child processes on dispose.

## 5. Scale and correctness

Design for: 1,000 threads, 100 projects, 10,000 tasks, a 10,000-message thread,
8 split panes, and a phone over Tailscale on a slow link. Lists past about 100
rows need virtualization or pagination.

- **Reload safety**: `bb plugin reload <id>` twice must leave no duplicate
  listeners, services, schedules, or UI.
- **Races**: async results must not apply after the user switches thread,
  project, or pane. Key results by id or abort stale requests.
- **Disconnects**: behave sensibly while the server or daemon reconnects.
- **Several clients**: desktop and phone can be open at once. Anything that
  must happen once (sounds, notifications, writes) is claimed on the server;
  `attention-alerts` `rings.claim` is the pattern.
- **Compact viewport**: check iOS Safari layouts and touch targets.
- **Failure isolation**: catch errors in event handlers, hooks, and services. A
  throwing plugin must not break bb or other plugins.
- **Data**: migrations are forward-only and tolerate old rows. Disabling or
  uninstalling the plugin leaves bb fully working.
- **Shortcuts**: grep `plugins/` and `apps/app` for the key combo before
  binding it.
- **Untrusted input**: thread text, Linear content, and file names never reach
  `dangerouslySetInnerHTML` or shell strings unescaped.

## 6. Verify and report

```sh
pnpm exec turbo run test typecheck lint --filter=bb-plugin-<name> --env-mode=loose
bb plugin build plugins/<name>
bb plugin reload <name>
bb plugin list
```

`--env-mode=loose` is required in the sandbox, which otherwise blocks Vite's
temp files. `bb plugin list` shows each plugin's handler calls and total/max
time; a max above about 50 ms or a fast-growing call count needs a look.
Install workspace dependencies with pnpm outside the sandbox and never pass
`--prefer-offline`.

Document the plugin's commands, settings, shortcuts, and fragile selectors in
its own `skills/<name>/SKILL.md`.

Report to the user:

- what you searched in step 2 and why you built or reused,
- every changed file, confirming all are inside the plugin,
- the idle cost and scale limits of the change,
- test, typecheck, and live-check results.
