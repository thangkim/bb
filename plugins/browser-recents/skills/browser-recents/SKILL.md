---
name: browser-recents
description: What the Browser recent links plugin shows in an empty Browser tab, where its links come from, and its limits.
---

# Browser recent links

bb's own new-tab screen in a Browser tab only lists pages visited from that
thread, so a fresh thread opens to a blank page. The Browser recent links
plugin fills every empty Browser tab with the 8 most recently visited links
across all threads, newest first. Clicking a link opens it in that tab.

- Links come from the per-thread browser history bb already keeps in this
  app's local storage, so they are specific to this device and app window
  origin. Clearing a thread's "Recently visited" list in bb removes its links
  here too.
- A URL visited from several threads appears once, with its latest visit time.
- The list covers bb's own new-tab list while the tab is empty and disappears
  as soon as the tab loads a page.

The plugin has no CLI commands, agent tools, or settings. It reads bb's
`bb.thread.browserHistory-<thread>-1` local storage keys, mounts inside
`[data-app-browser]`, and opens a link by submitting it through the tab's
address bar, so a bb UI change can stop it working. When that happens, the
empty tab falls back to bb's default new-tab screen.
