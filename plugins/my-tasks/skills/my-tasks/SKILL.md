---
name: my-tasks
description: "Work on or manage records in My Tasks, including task keys such as ABC-12."
---

# My Tasks

Use the `bb my-tasks` CLI to understand the assigned task, keep its record useful,
and report the outcome where the work is tracked.

My Tasks is organized as project → task → thread. Projects carry the workflow
status (`backlog`, `todo`, `in_progress`, `in_review`, `done`, `canceled`),
priority, due date, and description, and show progress as done tasks over all
tasks. Tasks are a checklist inside a project: each one is `todo` (not done) or
`done`. Threads are attached to tasks.

For task dispatch and execution presets, read
[references/delegation.md](references/delegation.md).

## Work a task

1. Find and read the task before acting:

   ```sh
   bb my-tasks show ABC-12
   ```

   The detail includes the description, done state, priority, labels,
   comments, attachments, attached worker threads, and the GitHub pull
   requests those threads produced (from environment metadata, with state
   open/draft/merged/closed). Use
   `bb my-tasks show ABC-12 --json` when the result will drive commands or code.

   For project-wide discovery, `bb my-tasks list` returns at most 100 rows by
   default. Pass `--limit 1-500`; in JSON, continue with `nextCursor` via the
   same filters/sort and `--cursor <value>`. A task-list mutation makes an old
   cursor stale, so restart without it.

2. Fetch every relevant attachment before making assumptions about it:

   ```sh
   bb my-tasks attachment get <attachment-id> --out <path>
   ```

3. Do the work. Post one substantive comment at each meaningful milestone,
   such as a completed investigation, an implementation ready for validation,
   or a concrete blocker:

   ```sh
   bb my-tasks comment ABC-12 --body "Implemented the change; focused validation now passes."
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
   bb my-tasks attachment add ABC-12 --file ./report.md
   bb my-tasks attachment add ABC-12 --file ./screenshot.png
   ```

   Read `references/attachments.md` for comment attachments, initial files,
   removal rules, and machine selection.

5. Mark the task done when its completion criteria are met:

   ```sh
   bb my-tasks update ABC-12 --status done
   ```

   Reopen it with `--status todo`. When review is still required, leave the
   task open and say so in a comment; review state belongs to the project
   (`bb my-tasks project update ABC --status in_review`), and only change it
   when you were asked to manage the project.

   If the work cannot proceed, leave the task open and comment with the
   specific blocker, what you tried, and what would unblock it. Do not mark a
   blocked task done.

6. Delegated threads are attached automatically. If this thread was not
   delegated from Tasks, attach it yourself so the task shows the active work:

   ```sh
   bb my-tasks attach ABC-12
   ```

   When a thread is done with a task (hand-off, respawned replacement, or a
   predecessor that died), detach it so `bb my-tasks threads ABC-12` stays
   accurate. Omit `--thread` to detach the current thread:

   ```sh
   bb my-tasks detach ABC-12 --thread thr_dead_predecessor
   ```

   `bb my-tasks links` lists the tasks and projects the current thread is
   attached to. People attach from a thread's menu with **Attach to My
   Tasks…**.

## Keep the project brief current

A project's description is its brief, with the sections Problem, Context,
Priority, Solution, and Decisions (a bullet list). Threads attached to a project,
or to a task in it, get a reminder in their instructions.

- When a decision in the thread adds, changes, or drops any part of the brief,
  ask the user once whether to update it, naming the exact change. Update only
  after they agree.
- When the user says "summarize thread into project" or "update project
  summary", read the brief with `my_tasks_project_brief`, then call
  `my_tasks_update_project_brief` with only what changed, and report it.
- Delete decisions that were dropped or reversed (`removeDecisions`); do not
  keep superseded ones. Reword in place with `replaceDecisions`.
- Pass `project` (a prefix) when the thread is linked to several projects or
  none. Without the tools, use `bb my-tasks project brief ABC` to read it and
  `--problem`, `--context`, `--priority-note`, `--solution`, `--clear`,
  `--add-decision`, and `--remove-decision` to change it.

## Link tasks in responses

When your answer refers the user to a task — including a task you just
created — emit this leaf directive on its own line instead of writing the
key as plain text:

```md
::my-task{key="ABC-12"}
```

`key` is required. Optionally add `title="…"` as a display fallback shown
while the card loads and when the key no longer resolves. The rendered card
shows the live done state, title, and priority, opens the task in the thread
side panel, and links to the full Tasks app. Emit one directive per line;
each renders its own card.

## CLI conventions

- `bb my-tasks --help` lists every command, and `bb my-tasks <command> --help` prints
  that command's arguments, accepted values, and limits. Both exit 0.
- `--project` takes a tracker project prefix or id such as `ABC`, never a bb
  project id (`proj_...`). `bb my-tasks project list` shows both columns.
- `bb my-tasks status` reports the plugin's name and version. A project's
  workflow status is set with `bb my-tasks project update ABC --status <status>`
  or `bb my-tasks project move ABC --status <status> [--after XYZ | --before XYZ]`;
  `bb my-tasks project complete ABC` marks the project done and every open
  task in it done, matching the checkbox on the project's list row;
  `bb my-tasks project list` and `project show` report status, priority, due
  date, and progress. A task's done state is `bb my-tasks update ABC-12
  --status done|todo`.
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
  project level: `bb my-tasks project attach ABC` (current thread, or
  `--thread <id>`), `bb my-tasks project detach ABC`, and
  `bb my-tasks project threads ABC`. Start a new project-level thread with
  `bb my-tasks project dispatch ABC --preset <name>`.
- `bb my-tasks move ABC-12 --project XYZ` moves a task to another project and
  gives it a new key there (for example `XYZ-4`); use the new key afterwards.
- Write one comment per meaningful milestone. Combine related facts into a
  useful update; never spam progress pings, command-by-command narration, or
  repeated status messages.
- Comments should say what changed or was learned, what validation ran, and any
  remaining risk or blocker.
- Prefer stable task keys such as `ABC-12` for task commands. Use `--json` for
  machine-readable output and human output for quick inspection.
