# My Tasks

My Tasks is a personal fork of bb's Tasks plugin: a Linear-style tracker inside bb for planning work, delegating it to
agents, and keeping the task record connected to the threads doing the work.
Work is organized as project → task → thread. Projects carry the workflow
status, priority, due date, description, and a progress bar (done tasks over
all tasks). Tasks are a checklist inside a project, done or not done, with
labels, due dates, Markdown comments, attachments, and the agent threads
working on them. There is also a full CLI.

## Install

Install My Tasks from this repository path. It runs alongside the bundled Tasks
plugin with its own id, storage, CLI, and message directive.

```sh
bb plugin build plugins/my-tasks
bb plugin install plugins/my-tasks
```

After edits, rebuild and run `bb plugin reload my-tasks`.

The plugin adds the My Tasks sidebar panel, the `bb my-tasks` command, and an agent
skill that teaches workers how to report progress back to tasks.

## Quick start

Install the plugin as shown above. Then use the `bb my-tasks` CLI
to create a tracker project. Link it to the bb project where delegated agents
will run:

```sh
bb my-tasks project create \
  --name "Product" \
  --prefix PROD \
  --link-bb-project proj_your_bb_project

bb my-tasks create \
  --project PROD \
  --title "Ship task delegation" \
  --description "Implement the flow and run focused validation." \
  --priority high

bb my-tasks list --project PROD
bb my-tasks show PROD-1
bb my-tasks preset list
bb my-tasks delegate PROD-1 --preset "GPT-5.6 · high"
```

When the CLI runs inside a linked bb project, `create` and `list` infer the
tracker project, so `--project` can be omitted. Task keys are case-insensitive
at the CLI boundary. You can also delegate from a task's **Delegate** menu,
choose or create presets under **Manage → Presets**, and type `@` in the bb
composer to send a task mention to an agent.

The comment composer shows a **Notify last responding agent** switch. When the
task has an agent reply, leave it on to send the new comment to the thread that
authored the latest reply, resuming that thread when it is idle. Turn it off to
keep the comment in Tasks only. If no agent has replied, the disabled control
says so explicitly. Agents and scripts can use the same behavior with
`bb my-tasks comment PROD-1 --body "New context" --notify`.
When run from a thread, the CLI preserves that agent thread and any explicit
`--author`; notification still targets the prior latest responder rather than
the newly recorded agent comment itself.

## CLI reference

Run `bb my-tasks --help` or `bb my-tasks <command> --help` for exact options; help
works at every level, lists each option's accepted values and limits, and exits 0. Unknown commands and options are rejected with the nearest real name, every
missing required value is reported in one error, and a failing invocation that
carries `--json` prints `{ "ok": false, "error": { "code", "message", "hint"? } }`
on stdout while stderr keeps the readable text. Add `--json` to commands when
another command or agent will consume the output.

`--project` takes a tracker project prefix or id such as `PROD`, never a bb
project id (`proj_...`); `bb my-tasks project list` shows both columns. Repeatable
options (`--label`, `--status`, `--priority`, `--add-label`, `--remove-label`)
also accept one comma-separated list. File paths (`--file`, `--attach`,
`--out`, `--description-file`, `--body-file`) resolve on the invoking machine:
inside an agent thread that is the thread's machine, otherwise the server's
machine; pass `--machine <id-or-name>` to target another enrolled machine.

| Command                                        | Purpose                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `bb my-tasks status`                              | Show the installed My Tasks plugin name and version.                                                                                       |
| `bb my-tasks project create\|list\|show\|update`  | Manage projects: status, priority, due date, description, folder, color, prefix, and bb-project link. `list`/`show` report progress.      |
| `bb my-tasks project dispatch <prefix> --preset <name>` | Start a new agent thread for the whole project and attach it at the project level, not to a task.                              |
| `bb my-tasks project attach\|detach\|threads <prefix>` | Attach the current thread (or `--thread <id>`) to a project, detach it, or list the threads attached at the project level.            |
| `bb my-tasks project move <prefix>`               | Move a project to a status column, optionally `--after`/`--before` another project in that column.                                         |
| `bb my-tasks project complete <prefix>`           | Mark a project done and every open task in it done in one step, as the list row checkbox does.                                             |
| `bb my-tasks project brief <prefix>`              | Show the project brief, or update it with `--problem`, `--context`, `--priority-note`, `--solution`, `--clear`, `--add-decision`, `--remove-decision`. |
| `bb my-tasks folder create\|list\|update\|delete` | Organize tracker projects into nested folders. Deleting a folder moves its projects and subfolders to the top level; no tasks are deleted. |
| `bb my-tasks create`                              | Create a task with description, priority, labels, due date, and file attachments (repeatable `--attach <path>`).                          |
| `bb my-tasks list`                                | Page/filter tasks by project, done state, priority, label, active agents, or search text; supports `--sort`, `--limit`, and `--cursor`.    |
| `bb my-tasks show <key-or-id>`                    | Show the complete task record, including comments, attachments, and attached threads.                                                      |
| `bb my-tasks update <key-or-id>`                  | Mark done (`--status done`) or reopen (`--status todo`), or update priority, title, description, due date, or labels.                     |
| `bb my-tasks move <key-or-id> --project <prefix>` | Move a task into another project. It gets the next key there and keeps comments, attachments, and threads; labels from the old project are removed. |
| `bb my-tasks comment <key-or-id>`                 | Add a Markdown comment from inline text or a file; optionally notify the latest responding task agent.                                     |
| `bb my-tasks attachment add\|get\|list\|remove`   | Add, fetch, list, or remove attachments. Referenced attachments require `remove --remove-references`.                                      |
| `bb my-tasks preset list\|create\|update\|delete` | Manage reusable agent execution presets.                                                                                                   |
| `bb my-tasks delegate <key>`                      | Start and attach a new agent thread using a preset.                                                                                        |
| `bb my-tasks attach <key-or-id>`                  | Attach the current bb thread to a task when it was not delegated from Tasks.                                                               |
| `bb my-tasks detach <key-or-id>`                  | Detach the current bb thread (or `--thread <id>`) from a task, for example a dead predecessor after a respawn.                             |
| `bb my-tasks threads <key>`                       | List the bb threads attached to a task: live threads first, newest first.                                                                  |
| `bb my-tasks links`                               | List the tasks and projects the current thread (or `--thread <id>`) is attached to.                                                        |
| `bb my-tasks label create\|list\|delete`          | Manage project-scoped labels.                                                                                                              |
| `bb my-tasks seed-demo --yes`                     | Create sample folders, projects, labels, tasks, and comments for evaluation.                                                               |

Project statuses are `backlog`, `todo`, `in_progress`, `in_review`, `done`,
and `canceled`. Task statuses are `todo` and `done`. Priorities are `urgent`,
`high`, `medium`, `low`, and `none`.

Task lists default to 100 rows and accept `--limit 1-500`. JSON output is
`{ tasks, nextCursor, limit }`; human output prints the continuation option
when another page exists. The cursor is opaque and tied to the filters, sort,
and current task-list revision. If tasks are added, removed, reordered, or
updated between requests—or label links/names, active task threads, or project
prefixes change—the old cursor is rejected. Restart from the first page rather
than traversing an inconsistent snapshot.

## Agents, delegation, and presets

Linking a Tasks project to a bb project enables delegation. Open a task, choose
**Delegate**, select a preset, and optionally add instructions. A preset
defines the provider, model, reasoning level, optional service tier, permission
mode, and reusable instructions. Presets are user-defined, so create the worker profiles your team
uses repeatedly before dispatching work.

Delegation creates a worker thread in the linked bb project, attaches that
thread to the task, and advances a `backlog` or `todo` project to
`in_progress`. The worker receives the task description, the project's
context and other tasks, attachments, recent comments, preset instructions,
and a report-back contract. Its installed skill tells it to inspect the task,
leave substantive milestone comments, attach artifacts, and mark the task done
when its criteria are met.

Project task lists (an expanded row in the list, and the project page) hide
done tasks by default. A task you check off stays visible until you collapse
the project or leave the page, so you can undo it. Turn on **Show completed
tasks** in Settings → Plugins → My Tasks, or run
`bb plugin config my-tasks set showCompletedTasks true`, to always show them.

When a thread is open in a split pane next to My Tasks, the list highlights
the project it is attached to (directly, or through one of its tasks) with an
accent bar, plus the matching task and thread inside the expanded row. The
highlight follows the focused thread pane and stays on the last focused thread
while you work in the My Tasks pane.

Drag a task onto another project in the list (or use **Move to project** in its
right-click menu) to move it there.

In the app, every task row has **New thread** (pick a preset) and **Attach
thread** (search your bb threads). Every project row in the list, collapsed
or expanded, lists the project's own threads under its priority and due date,
with icon-only **New thread** (starts with the last-used preset) and **Attach
thread** buttons beside the due date; expanding a row adds its tasks below.
The project page shows the same threads with the labelled actions. Those
threads belong to the project, not to any task. Clicking a thread opens it in a split
pane.
Going the other way, every thread's menu (right-click a sidebar row, its "…"
button, or the thread header menu) has **Attach to My Tasks…**. It opens a
dialog that suggests open tasks from projects linked to the thread's bb
project, searches all tasks and projects, and lists what the thread is already
attached to; select an attached item to detach it.

If work begins outside the Delegate action, the agent can associate its current
thread with `bb my-tasks attach KEY`. The inverse is `bb my-tasks detach KEY
[--thread <id>]`, and each thread card on the task page has a detach control;
use either to drop a thread that died or moved on to other work. The task
page and `bb my-tasks threads` list live threads before completed or failed ones,
newest first.

## Project brief

A project's description doubles as its brief: Problem, Context, Priority,
Solution, and a Decisions list. Agents get two tools,
`my_tasks_project_brief` and `my_tasks_update_project_brief`, which change one
section or one decision at a time, so threads working on the same project do
not overwrite each other. Threads attached to the project or one of its tasks
are told to ask before updating the brief; saying "summarize thread into
project" or "update project summary" asks for the update directly. Dropped
decisions are deleted. Other headings and text in the description are kept.
Instructions reach a thread when its agent session starts or resumes.

## Task mentions

Type `@` in the bb composer and select **Tasks** to search by task key or title. Select **My Tasks Projects** instead to send a whole project: its status,
priority, due date, description, task checklist, and project-level threads.
Sending the mention gives the agent the task's description, done state,
priority, labels, the project's other tasks, attachments, recent comments, attached threads, and CLI
action contract as context. Tasks linked to the current bb project rank first.

Inside a task description or comment, `@` also inserts a task pill. These
references are stored in Markdown as `[PROD-1](bbtask://PROD-1)`, so they remain
portable in task content.

Mentioning a task key such as `PROD-1` in an agent request also activates the
Tasks skill, which directs the worker to read and update the tracked task.

## Known limitations

- The **Auto** delegation preset is deferred; choose an explicit preset.
- List filters are local UI state and are not persisted in the URL.

## Fast follow

- Batch task-list enrichment for comments and attached-thread state.
- Add notifications and an inbox for task activity.
- Add a command palette entry for Tasks to cmd-K.
