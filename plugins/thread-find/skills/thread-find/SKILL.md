---
name: thread-find
description: Explain or troubleshoot the Find in thread bar (Cmd/Ctrl+F) that searches the text of the focused thread timeline.
---

Find in thread is a frontend-only plugin. Install it from a bb checkout with `bb plugin install ./plugins/thread-find`, then enable it in Settings → Plugins.

Press Command+F on macOS or Control+F elsewhere while a thread is on screen. The bar opens at the top right of the thread you are working in: the thread whose composer or timeline has focus, including a side chat, or else the main thread of the focused split pane. It searches the rendered text of that thread's timeline case-insensitively and skips the composer, floating overlays, and hidden content.

- Enter or Command/Control+G moves to the next match; add Shift to move to the previous one. The counter shows `current/total` or `No results`.
- Opening the bar or changing the query jumps to the first match at or below the top of the view. Moving to a match scrolls it to the middle of the thread and stops the thread from sticking to the bottom.
- Escape or the close button hides the bar and returns focus to where it was. The query is kept for the next search in the same window.
- New or changed timeline text is searched again 150 ms after it settles.
- While the bar is open every timeline row stays mounted so off-screen rows can match; very long threads can feel slower until the bar closes.

Command/Control+F is left alone in the in-app browser, in terminals, while a dialog is open, and when no thread is on screen, so the browser and desktop window find keep working there.

The palette command `Find in thread` (`plugin:thread-find/find`) opens the same bar for the focused thread and has no default shortcut; assign one in Settings → Keyboard. The plugin has no settings, RPC methods, or CLI commands.
