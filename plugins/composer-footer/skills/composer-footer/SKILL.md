---
name: composer-footer
description: What the Pinned composer footer plugin changes about a thread composer's footer row, and its limits.
---

# Pinned composer footer

bb hides the footer row under a thread's composer (project, environment,
permission mode, and context usage) when the composer sits in a narrow or short
pane, such as a thread opened in a side panel. The Pinned composer footer
plugin keeps that row visible in every thread composer.

- It applies to thread composers only, not the new-thread composer or queued
  message editors.
- Collapsing the prompt box with its chevron still hides the footer, and on
  phone-sized screens the footer still appears only while the composer is
  expanded. bb does not render the row in those states.

The plugin has no CLI commands, agent tools, or settings. It sets bb's own
`data-follow-up-composer-footer-visible` attribute on `[data-follow-up-composer]`
inside `[data-promptbox-shell]`, so a bb UI change can stop it working. When
that happens, the footer falls back to bb's default behavior.
