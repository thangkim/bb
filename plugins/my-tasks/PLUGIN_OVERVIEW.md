Turn a plan into tracked tasks, hand each task to an agent, and see the worker's progress on the task itself.

## What you get

- A **My Tasks** panel listing projects grouped by status, with a List/Board toggle, filters, a project page, and a detail page for each task. Collapsed status sections, expanded projects, and collapsed sidebar folders are remembered across reloads.
- Projects with status, priority, due date, a description you can paste or drop images into, file attachments, and a progress bar; tasks inside them are a checklist (done or not done) with labels, due dates, and file attachments.
- **New thread** and **Attach thread** on every task; clicking a thread opens it in a split pane.
- **New thread** on a project or a task opens an empty composer beside the list. The thread you send from it is attached to that project or task.
- **Splits keep links**: a thread created in a split pane opened from an attached thread joins the same tasks and projects.
- **Side chats nest under their thread**: side chats you replied in are listed under the project or task thread they branch from.
- **Attach to My Tasks…** in every thread's menu: search projects and tasks, and attach or detach the thread in one dialog.
- **Thread header badge**: an attached thread's header shows its task (or its project when no task is attached); click it to open the task or project.
- Markdown comments with a **Notify last responding agent** switch. The comment goes to the worker thread and resumes it when idle.
- A **Delegate** menu that starts a worker thread from a preset. A preset sets the provider, model, reasoning level, permission mode, and instructions.
- Live thread cards on each task and a **Task** panel action inside a thread.

## How it works

Link a tracker project to a bb project. Delegation then creates a worker thread there, attaches it to the task, and moves a planned project to `in_progress`. The worker receives the description, the project's other tasks, attachments, recent comments, and a report-back contract.

Type `@` in the composer and choose **My Tasks** to send a task as context. Agents see a `::my-task{key="PROD-1"}` card when they reference a task.

## For agents

The `bb my-tasks` CLI covers the full tracker: `create`, `list`, `show`, `update`, `comment`, `attachment`, `preset`, `delegate`, `attach`, `detach`, `threads`, `reorder`, `label`, `project`, and `folder`. Add `--json` for machine-readable output. The bundled `my-tasks` skill tells workers to read the task, comment at milestones, attach artifacts, and mark the task done.

Presets are user-defined. Create at least one before you delegate.
