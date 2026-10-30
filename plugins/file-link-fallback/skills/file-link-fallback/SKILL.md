---
name: file-link-fallback
description: "Explain or diagnose the File link fallback plugin, which opens Markdown links whose path is relative to another repo or starts with ~ instead of showing 'Path does not exist'."
---

# File link fallback

bb resolves a Markdown file link against the thread's workspace. A link such as
`references/holistics/writing-guideline.md` (relative to a different repo) or
`~/.claude/skills/x/SKILL.md` (tilde never expanded) therefore ends in
"HTTP 404: Path does not exist". This plugin registers a Markdown file opener
("Markdown (find file)") that looks for the file elsewhere and shows it
read-only.

## Lookup order

1. `~` or `~/...`: expanded to the home directory.
2. An absolute path: used as is.
3. A relative path: the thread's workspace first. If the file exists there the
   plugin renders bb's own preview (`Original`). Otherwise it tries, in order,
   the home directory, `~/.claude`, `~/.claude/skills`, and every folder up to
   two levels under `/tmp/claude-<uid>` and `~/.claude/plugins/marketplaces`.
   When several match, the most recently modified wins and the header says how
   many others exist.

## Setup

Install with `bb plugin install ./plugins/file-link-fallback`. Then open
Settings → Files and pin "Markdown (find file)" for `md`, or bb keeps using the
first opener in slot order. The Docs editor stays available from the file
tab's "Open with" menu.

## Limits

- Read-only; no editing of fallback files.
- "Open with built-in preview" is bb's own viewer and still 404s outside the
  workspace.
- The search runs on the machine the bb server runs on. Environments on another
  host pass straight through to the normal opener.
- Any file the bb server user can read can be shown if a link names it. That is
  the point of the plugin; disable it to restore the workspace-only rule.
- No settings, commands or agent tools.

## Diagnosing

- Still 404: the plugin is disabled or not pinned for `md`, or the tab used
  "Open with built-in preview".
- "Could not find ...": the tab lists every path tried. Add the repo's folder
  to `buildSearchRoots` in `server.ts` if it lives somewhere else.
