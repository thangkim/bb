---
name: tomato
description: "Work on or manage records in Tomato, including task keys such as ABC-12."
---

# Tomato

Use the `bb tomato` CLI to understand the assigned task, keep its record useful,
and report the outcome where the work is tracked.

Tomato is organized as project → task → thread. Projects carry the workflow
status (`backlog`, `todo`, `in_progress`, `in_review`, `done`, `canceled`),
priority, due date, and description, and show progress as done tasks over all
tasks. Tasks are a checklist inside a project: each one is `todo` (not done) or
`done`. Threads are attached to tasks.

For task dispatch and execution presets, read
[references/delegation.md](references/delegation.md).

## Work a task

1. Find and read the task before acting:

   ```sh
   bb tomato show ABC-12
   ```

   The detail includes the description, done state, priority, labels,
   comments, attachments, attached worker threads, and the GitHub pull
   requests those threads produced (from environment metadata, with state
   open/draft/merged/closed). Use
   `bb tomato show ABC-12 --json` when the result will drive commands or code.

   For project-wide discovery, `bb tomato list` returns at most 100 rows by
   default. Pass `--limit 1-500`; in JSON, continue with `nextCursor` via the
   same filters/sort and `--cursor <value>`. A task-list mutation makes an old
   cursor stale, so restart without it.

2. Fetch every relevant attachment before making assumptions about it:

   ```sh
   bb tomato attachment get <attachment-id> --out <path>
   ```

3. Do the work. Post one substantive comment at each meaningful milestone,
   such as a completed investigation, an implementation ready for validation,
   or a concrete blocker:

   ```sh
   bb tomato comment ABC-12 --body "Implemented the change; focused validation now passes."
   ```

   Add `--notify` only when the new comment should be delivered to the thread
   that authored the task's most recent agent reply. This resumes an idle
   recipient; with no prior agent reply, the comment is recorded without
   targeting an unrelated thread. In agent context, the new comment keeps the
   current thread identity and an explicit `--author`, while delivery still
   targets the prior latest responder rather than the new comment itself.

4. Attach result artifacts that belong with the task, such as reports,
   screenshots, patches, or generated files:

   ```sh
   bb tomato attachment add ABC-12 --file ./report.md
   bb tomato attachment add ABC-12 --file ./screenshot.png
   ```

   Read `references/attachments.md` for comment attachments, initial files,
   removal rules, and machine selection.

5. Mark the task done when its completion criteria are met:

   ```sh
   bb tomato update ABC-12 --status done
   ```

   Reopen it with `--status todo`. When review is still required, leave the
   task open and say so in a comment; review state belongs to the project
   (`bb tomato project update ABC --status in_review`), and only change it
   when you were asked to manage the project.

   If the work cannot proceed, leave the task open and comment with the
   specific blocker, what you tried, and what would unblock it. Do not mark a
   blocked task done.

6. Delegated threads are attached automatically. If this thread was not
   delegated from Tasks, attach it yourself so the task shows the active work:

   ```sh
   bb tomato attach ABC-12
   ```

   When a thread is done with a task (hand-off, respawned replacement, or a
   predecessor that died), detach it so `bb tomato threads ABC-12` stays
   accurate. Omit `--thread` to detach the current thread:

   ```sh
   bb tomato detach ABC-12 --thread thr_dead_predecessor
   ```

   `bb tomato links` lists the tasks and projects the current thread is
   attached to. People attach from a thread's menu with **Attach to My
   Tasks…**. An attached thread's header shows the same link among its
   header actions: the first task's title in blue (with `+N` for more
   tasks), or the project name when no task is attached. Clicking it opens
   the picker to change the link. A split pane collapsed by Pane Collapse
   shows the same task or project on its strip.

## Keep the project brief current

A project's description is its brief, with the sections Problem, Context,
Priority, Solution, and Decisions (a bullet list). Threads attached to a project,
or to a task in it, get a reminder in their instructions.

- When a decision in the thread adds, changes, or drops any part of the brief,
  ask the user once whether to update it, naming the exact change. Update only
  after they agree.
- When the user says "summarize thread into project" or "update project
  summary", read the brief with `tomato_project_brief`, then call
  `tomato_update_project_brief` with only what changed, and report it.
- Delete decisions that were dropped or reversed (`removeDecisions`); do not
  keep superseded ones. Reword in place with `replaceDecisions`.
- Pass `project` (a prefix) when the thread is linked to several projects.
  The tools exist only in threads attached to a project or task. Without them, use `bb tomato project brief ABC` to read it and
  `--problem`, `--context`, `--priority-note`, `--solution`, `--clear`,
  `--add-decision`, and `--remove-decision` to change it.

## Link tasks in responses

When your answer refers the user to a task — including a task you just
created — emit this leaf directive on its own line instead of writing the
key as plain text:

```md
::tomato-task{key="ABC-12"}
```

`key` is required. Optionally add `title="…"` as a display fallback shown
while the card loads and when the key no longer resolves. The rendered card
shows the live done state, title, and priority, opens the task in the thread
side panel, and links to the full Tasks app. Emit one directive per line;
each renders its own card.

## CLI conventions

- `bb tomato --help` lists every command, and `bb tomato <command> --help` prints
  that command's arguments, accepted values, and limits. Both exit 0.
- `--project` takes a tracker project prefix or id such as `ABC`, never a bb
  project id (`proj_...`). `bb tomato project list` shows both columns.
- `bb tomato status` reports the plugin's name and version. A project's
  workflow status is set with `bb tomato project update ABC --status <status>`
  or `bb tomato project move ABC --status <status> [--after XYZ | --before XYZ]`;
  `bb tomato project complete ABC` marks the project done and every open
  task in it done, matching the checkbox on the project's list row;
  `bb tomato project list` and `project show` report status, priority, due
  date, and progress. A task's done state is `bb tomato update ABC-12
  --status done|todo`.
- List display settings are plugin config, not `bb tomato` flags:
  `bb plugin config tomato set showCompletedTasks true` keeps done tasks in
  expanded project rows (the project page always shows them, after open
  tasks), and
  `bb plugin config tomato set showCollapsedProjectThreads true` lists
  project threads on collapsed project rows. Both default to false.
- `autoTrackThreads` (default true) gives a new thread with no task or project
  attached the `tomato_track_thread` tool and instructions to file a 2-5 word
  task in the best-fitting project. Call it once, before other work; it does
  nothing when the thread is already attached to a task.
- Repeatable options (`--label`, `--status`, `--priority`, `--add-label`,
  `--remove-label`) accept a repeated flag or one comma-separated list.
- Unknown options and stray arguments are errors, never ignored, and every
  missing required value is reported in one error. A failing command run with
  `--json` prints `{"ok":false,"error":{"code","message","hint"?}}` on stdout.

## Invariants

- Task statuses are `todo` and `done`. Project statuses are `backlog`, `todo`,
  `in_progress`, `in_review`, `done`, and `canceled`.
- Use `done` only when the task's completion criteria are met.
- Tasks have no sub-tasks; split larger work into more tasks in the same
  project.
- Work that spans a whole project rather than one task attaches at the
  project level: `bb tomato project attach ABC` (current thread, or
  `--thread <id>`), `bb tomato project detach ABC`, and
  `bb tomato project threads ABC`. Project-level files use
  `bb tomato attachment add --project ABC --file <path>`; a project
  dispatch prompt lists them. Start a new project-level thread with
  `bb tomato project dispatch ABC --preset <name>`. In the app, a project's
  New thread only opens an empty composer; the next top-level thread created
  in the linked bb project within 10 minutes is attached to the project.
- `bb tomato move ABC-12 --project XYZ` moves a task to another project and
  gives it a new key there (for example `XYZ-4`); use the new key afterwards.
- `bb tomato reorder ABC-12 --after ABC-3` (or `--before`) changes a task's
  place in its project. `bb tomato project reorder-thread ABC --thread <id>
  --after <thread-id>` (or `--before`) does the same for project-level threads.
- Write one comment per meaningful milestone. Combine related facts into a
  useful update; never spam progress pings, command-by-command narration, or
  repeated status messages.
- Comments should say what changed or was learned, what validation ran, and any
  remaining risk or blocker.
- Prefer stable task keys such as `ABC-12` for task commands. Use `--json` for
  machine-readable output and human output for quick inspection.
