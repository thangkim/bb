Ask a follow-up question about one message without adding noise to the main conversation. A side chat is a fork of the thread that opens in a panel beside it.

## What you get

- A **Reply in side chat** action on any message. Select part of the message first to reply to only that text.
- A **Start side chat** panel action for a fork that starts from the current thread state.
- A panel that shows the quoted message and a compact chat with its own composer.
- A **Send to main thread** action on side-chat replies. It queues the reply as a message in the original thread.
- An automatic label. After its first reply, the side-chat agent names the side chat in 2 to 5 words. The name becomes the thread title and the panel tab's label.
- An editable title at the top of the panel. Click it, type, and press Enter to rename; Escape cancels. A name you set is never replaced by the agent.

## How it works

The fork copies the conversation up to the chosen message and reuses the same workspace. The quoted text is given to the agent as context. Side chats stay hidden from the sidebar, so they do not clutter your thread list.

Once per hour, the plugin looks for side chats older than 24 hours. A side chat with no user message and no queued message is archived. A side chat you used is kept.

The plugin adds one agent tool, `side_chat_set_title`, offered only inside its own side chats. It sets the title only while the thread has none. The plugin adds no CLI commands; rename a side chat from a script with `bb thread update <id> --title <text>`.

This plugin is a copy of the built-in Side chat plugin. Disable the built-in one so the message and panel actions are not offered twice.
