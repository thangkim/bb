---
name: side-chat-plus
description: How Side chat+ names side chats automatically and lets a person rename them, including the side_chat_set_title tool and its limits.
---

# Side chat+

Side chat+ is the user's copy of the built-in Side chat plugin (`side-chat`),
with automatic and editable labels. Keep the built-in plugin disabled so the
"Reply in side chat" and "Start side chat" actions appear once.

## Labels

- Inside a side chat, the agent has the `side_chat_set_title` tool. At the end
  of its first reply it calls the tool once with a 2 to 5 word label in the
  user's language. The tool row is collapsed by default.
- The tool sets the thread title only while it is empty, so a name the user
  chose is never replaced. Labels are trimmed of quotes and a trailing period
  and capped at 60 characters.
- The tool is selected through `bb.agents.configure` only when the thread's
  origin is a fork by this plugin. Main threads and built-in side chats never
  see it.
- The server publishes `side-chat:title` with `{ threadId, title }`; an open
  panel updates its header and tab label from that event.

## Renaming

- The panel header shows the title. Clicking it opens an input: Enter saves
  through `sdk.threads.update`, Escape or an unchanged value cancels.
- The tab label follows by re-opening the panel with identical params and the
  new title (`useBbNavigate().openThreadPanel`), which focuses the existing
  tab and updates its label. bb mounts only the active tab's content, so this
  never steals focus from another tab.
- From a script: `bb thread update <thread-id> --title "<text>"`. An open
  panel picks up the new name the next time it mounts.

## Limits

- Side chats created before this plugin, or by the built-in plugin, have no
  title and keep the "Side chat" tab label until renamed.
- The tool reaches a side chat when its agent session starts. A side chat
  whose first message was sent before the plugin loaded has no tool until its
  session restarts.
- bb's own title AI is not used: plugins cannot call it, and bb only titles a
  thread created with a first message.
