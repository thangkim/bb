---
name: focused-diff
description: What the Focused diff plugin changes when a person clicks a changed file above a thread's composer, and its limits.
---

# Focused diff

The Focused diff plugin changes what happens when a person clicks a changed file in the
changed-files list above a thread's composer. Instead of opening bb's Git
Diff panel with every changed file, it opens a "File diff" side-panel tab that
shows only that file's diff.

- The diff compares the merge-base branch with the working tree, which matches
  bb's Git Diff "All changes" view. The branch is the environment's merge-base
  branch, then its base branch, then its default branch. Without any of them, the
  tab shows uncommitted changes only.
- The tab refreshes when the person clicks the same file again, when the window
  regains focus, every 10 seconds while visible, and from its refresh button.
- A toggle in the tab header switches between the unified view and the split
  (side-by-side) view. The choice is stored in the browser's localStorage and
  applies to every File diff tab.
- Clicking another file opens a sibling tab. Clicking the same file focuses its
  existing tab.
- Added, untracked, and deleted files keep bb's own file preview.
- Modifier clicks (Cmd, Ctrl, Shift, Alt) keep bb's default behavior.

The plugin has no CLI commands, agent tools, or settings. It recognizes the changed-file rows by
bb's DOM (`#thread-prompt-banner-git-body` and the `Open <path>` button label),
so a bb UI change can stop the interception. When that happens, clicks fall
back to bb's Git Diff panel.
