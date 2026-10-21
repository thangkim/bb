# Tomato

Tomato is a personal fork of bb's Tasks plugin: a Linear-style tracker inside bb for planning work, delegating it to
agents, and keeping the task record connected to the threads doing the work.
Work is organized as project → task → thread. Projects carry the workflow
status, priority, due date, description, and a progress bar (done tasks over
all tasks). Tasks are a checklist inside a project, done or not done, with
labels, due dates, Markdown comments, attachments, and the agent threads
working on them. There is also a full CLI.

## Install

Install Tomato from this repository path. It runs alongside the bundled Tasks
plugin with its own id, storage, CLI, and message directive.

```sh
bb plugin build plugins/tomato
bb plugin install plugins/tomato
```

After edits, rebuild and run `bb plugin reload tomato`.

The plugin adds the Tomato sidebar panel, the `bb tomato` command, and an agent
skill that teaches workers how to report progress back to tasks.

## Quick start

Install the plugin as shown above. Then use the `bb tomato` CLI
to create a tracker project. Link it to the bb project where delegated agents
will run:

```sh
bb tomato project create \
  --name "Product" \
  --prefix PROD \
  --link-bb-project proj_your_bb_project

bb tomato create \
  --project PROD \
  --title "Ship task delegation" \
  --description "Implement the flow and run focused validation." \
  --priority high

bb tomato list --project PROD
bb tomato show PROD-1
bb tomato preset list
bb tomato delegate PROD-1 --preset "GPT-5.6 · high"
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
`bb tomato comment PROD-1 --body "New context" --notify`.
When run from a thread, the CLI preserves that agent thread and any explicit
`--author`; notification still targets the prior latest responder rather than
the newly recorded agent comment itself.

## CLI reference

Run `bb tomato --help` or `bb tomato <command> --help` for exact options; help
works at every level, lists each option's accepted values and limits, and exits 0. Unknown commands and options are rejected with the nearest real name, every
missing required value is reported in one error, and a failing invocation that
carries `--json` prints `{ "ok": false, "error": { "code", "message", "hint"? } }`
on stdout while stderr keeps the readable text. Add `--json` to commands when
another command or agent will consume the output.

`--project` takes a tracker project prefix or id such as `PROD`, never a bb
project id (`proj_...`); `bb tomato project list` shows both columns. Repeatable
options (`--label`, `--status`, `--priority`, `--add-label`, `--remove-label`)
also accept one comma-separated list. File paths (`--file`, `--attach`,
`--out`, `--description-file`, `--body-file`) resolve on the invoking machine:
inside an agent thread that is the thread's machine, otherwise the server's
machine; pass `--machine <id-or-name>` to target another enrolled machine.

| Command                                        | Purpose                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `bb tomato status`                              | Show the installed Tomato plugin name and version.                                                                                       |
| `bb tomato project create\|list\|show\|update`  | Manage projects: status, priority, due date, description, folder, color, prefix, and bb-project link. `list`/`show` report progress.      |
| `bb tomato project dispatch <prefix> --preset <name>` | Start a new agent thread for the whole project and attach it at the project level, not to a task.                              |
| `bb tomato project attach\|detach\|threads <prefix>` | Attach the current thread (or `--thread <id>`) to a project, detach it, or list the threads attached at the project level.            |
| `bb tomato project reorder-thread <prefix>` | Move an attached thread (`--thread <id>`, default the current thread) `--after`/`--before` another attached thread in the project's thread list. |
| `bb tomato project move <prefix>`               | Move a project to a status column, optionally `--after`/`--before` another project in that column.                                         |
| `bb tomato project complete <prefix>`           | Mark a project done and every open task in it done in one step, as the list row checkbox does.                                             |
| `bb tomato project brief <prefix>`              | Show the project brief, or update it with `--problem`, `--context`, `--priority-note`, `--solution`, `--clear`, `--add-decision`, `--remove-decision`. |
| `bb tomato folder create\|list\|update\|delete` | Organize tracker projects into nested folders. Deleting a folder moves its projects and subfolders to the top level; no tasks are deleted. |
| `bb tomato create`                              | Create a task with description, priority, labels, due date, and file attachments (repeatable `--attach <path>`).                          |
| `bb tomato list`                                | Page/filter tasks by project, done state, priority, label, active agents, or search text; supports `--sort`, `--limit`, and `--cursor`.    |
| `bb tomato show <key-or-id>`                    | Show the complete task record, including comments, attachments, and attached threads.                                                      |
| `bb tomato update <key-or-id>`                  | Mark done (`--status done`) or reopen (`--status todo`), or update priority, title, description, due date, or labels.                     |
| `bb tomato move <key-or-id> --project <prefix>` | Move a task into another project. It gets the next key there and keeps comments, attachments, and threads; labels from the old project are removed. |
| `bb tomato reorder <key-or-id>`                 | Move a task `--after`/`--before` another task in the same project; with neither, it moves to the end.                                      |
| `bb tomato comment <key-or-id>`                 | Add a Markdown comment from inline text or a file; optionally notify the latest responding task agent.                                     |
| `bb tomato attachment add\|get\|list\|remove`   | Add, fetch, list, or remove task, comment, or project (`--project <prefix>`) attachments. Referenced attachments require `remove --remove-references`. |
| `bb tomato preset list\|create\|update\|delete` | Manage reusable agent execution presets.                                                                                                   |
| `bb tomato delegate <key>`                      | Start and attach a new agent thread using a preset.                                                                                        |
| `bb tomato attach <key-or-id>`                  | Attach the current bb thread to a task when it was not delegated from Tasks.                                                               |
| `bb tomato detach <key-or-id>`                  | Detach the current bb thread (or `--thread <id>`) from a task, for example a dead predecessor after a respawn.                             |
| `bb tomato threads <key>`                       | List the bb threads attached to a task: live threads first, newest first.                                                                  |
| `bb tomato links`                               | List the tasks and projects the current thread (or `--thread <id>`) is attached to.                                                        |
| `bb tomato label create\|list\|delete`          | Manage project-scoped labels.                                                                                                              |
| `bb tomato seed-demo --yes`                     | Create sample folders, projects, labels, tasks, and comments for evaluation.                                                               |

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

Linking a Tasks project to a bb project enables delegation. The link is the
project's **Default local folder**: the bb project (folder) where its new threads and
delegated workers start. Set it from the project page's properties; in a narrow
panel it sits in the chip row beside status, priority, and due date. You can also
right-click any **New thread** button to change the project's folder in place; every
later thread and task under that project uses the new folder. Open a task, choose
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

The project page always lists every task, with done tasks after open ones. An
expanded project row in the list hides done tasks by default. A task you check
off there stays visible until you collapse the project, so you can undo it.
Turn on **Show completed tasks** in Settings → Plugins → Tomato, or run
`bb plugin config tomato set showCompletedTasks true`, to always show them
there too.

A task or project you `@`-mention in a new thread's first prompt attaches the
thread to it as the message is sent: a mentioned task attaches the thread to the
task (its project follows from the task), a mentioned project attaches it at the
project level, and a `backlog` or `todo` project moves to `in_progress`. Only
top-level threads you start yourself qualify. Threads that are already attached,
side chats, forks, and agent-started threads are left alone, and so are later
messages in the thread.

New threads that mention nothing are tracked automatically. When a thread starts without a task or
project attached, its agent picks the best-fitting open project (one linked to
the thread's bb project, or one with no bb link), files a 2-5 word task modeled
on your recent task titles, and attaches the thread to it. Side chats, forks,
and child threads are skipped, and so is work that fits no project. Turn it off
with **Track new threads as tasks** in Settings → Plugins → Tomato, or
`bb plugin config tomato set autoTrackThreads false`.

When a thread is open in a split pane next to Tomato, the list highlights
the project it is attached to (directly, or through one of its tasks) with an
accent bar, plus the matching task and thread inside the expanded row. The
highlight follows the focused thread pane and stays on the last focused thread
while you work in the Tomato pane.

Drag a task onto another project in the list (or use **Move to project** in its
right-click menu) to move it there. Inside an expanded project row, drag a task
above or below another task to change their order.

Threads attached to a task or project are listed by latest activity, most
recent first. Drag a thread onto a task or a project row to move it there: it
is attached to the target and detached from where it was. Dragging the task or
project chip in a thread's header works like dragging the thread's title: drop
it on a pane edge to split, or on a task or project to move the open thread
there.

The list remembers which status sections you collapsed and which project rows
you expanded, and the navigation sidebar remembers which folders you collapsed.
This view state lives in the browser's local storage
(`bb-tomato:list-collapsed-statuses`, `bb-tomato:list-expanded-projects`,
and `bb-tomato:sidebar-collapsed-folders`), so it survives reloads and moving
between projects and views on the same device, and is shared by the All and
Active lists.

When Tomato sits side by side with other panes in a split, it keeps the
width you last dragged it to (stored in `localStorage` as
`bb-tomato:pane-width`) instead of the share bb assigns when panes open or
close; the other panes take the rest. bb has no plugin API for pane sizes, so
the plugin overrides the `flex-grow` of the pane's `[data-split-resize-grid-root]`
cell with a stylesheet and follows bb's divider while you drag it. Until you
drag it once, bb's sizing applies. Stacked splits and a lone pane are left
alone.

In the app, every task has **New thread** and **Attach thread** (search your
bb threads): labelled on the task page, icon-only on a task's checklist row
under a project. A task's **New thread** opens an empty composer for the
project's linked bb project, like a project's, and attaches the thread you send
to that task. To start a thread with the task's details already in the prompt,
use the **Dispatch** control in the task's properties or `bb tomato delegate`.
Every project row in the list has icon-only
**New thread** and **Attach thread** buttons beside its due date. Project rows
start collapsed with their threads hidden; expanding a row lists the project's
own threads under its priority and due date, with its tasks below. Turn on
**Show threads on collapsed projects** in Settings → Plugins → Tomato, or run
`bb plugin config tomato set showCollapsedProjectThreads true`, to list
project threads on collapsed rows too. A project's **New thread** opens bb's
New thread composer in a pane to the right of the list, switched to the
project's linked bb project, and starts nothing. bb has a single composer pane,
so when one is already open it is focused and switched instead; on compact
screens the New thread screen opens in place. The first thread you send from
bb in that project within 10 minutes is attached to the project. To start a
thread with the project's details already in the prompt, use
`bb tomato project dispatch`.
The project page shows the same threads with the labelled actions. Those
threads belong to the project, not to any task. Clicking a thread opens it in a split
pane.
Side chats you replied in are listed under the thread they branch from, in
project rows, task rows, and the task page's thread cards. Side chats from both
Side chat and Side chat+ are included; one you opened but never sent a message
in stays out of the list. Opening a side chat highlights its parent thread's
task and project.
Going the other way, every thread's menu (right-click a sidebar row, its "…"
button, or the thread header menu) has **Attach to Tomato…**. It opens a
dialog that suggests open tasks from projects linked to the thread's bb
project, searches all tasks and projects, and lists what the thread is already
attached to; select an attached item to detach it.

An attached thread's header shows what it belongs to among its header
actions: the task key and title when the thread is attached to a task (with
`+N` when there are more), otherwise the project name. Clicking a task opens it
in the thread's **Task** side panel; clicking a project opens its project page.
On phone-width viewports it collapses to an icon. `bb tomato links` prints
the same links from the CLI.

Splitting a thread that is attached to tasks or projects carries those links
over: when you open a new split pane from the active thread (for example with
Pane Splits' Alt+D or by Cmd/Ctrl-clicking bb's New thread) and send its first
message, the new thread is attached to the same tasks and projects. It only
applies to a thread created in that pane, in the same bb project, while the
source pane stays open; an existing thread opened in a split, and threads
already claimed by a Tomato **New thread**, are left alone.

If work begins outside the Delegate action, the agent can associate its current
thread with `bb tomato attach KEY`. The inverse is `bb tomato detach KEY
[--thread <id>]`, and each thread card on the task page has a detach control;
use either to drop a thread that died or moved on to other work. The task
page and `bb tomato threads` list live threads before completed or failed ones,
newest first.

With the Sidebar Tabs plugin installed, Tomato also fills the sidebar's
**Projects** tab with the same topbar, status and priority filters, and project
list as the All projects page. Opening a project or task from the sidebar opens
it in the Tomato panel. Filters, sort, and collapsed status groups are shared
with the All projects page.

## Project brief

A project's description doubles as its brief: Problem, Context, Priority,
Solution, and a Decisions list. Threads attached to a project or one of its
tasks get two tools, `tomato_project_brief` and
`tomato_update_project_brief`, which change one section or one decision at a
time, so threads working on the same project do not overwrite each other. Those
threads are told to ask before updating the brief; saying "summarize thread into
project" or "update project summary" asks for the update directly. Dropped
decisions are deleted. Other headings and text in the description are kept.
Other threads do not get the tools and use `bb tomato project brief` instead.
Tools and instructions reach a thread when its agent session starts or resumes,
so a thread attached mid-session gets them on its next session.

## Task mentions

Type `@` in the bb composer and select **Tasks** to search by task key or title. Select **Tomato Projects** instead to send a whole project: its status,
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
