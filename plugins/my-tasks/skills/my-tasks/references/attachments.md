# Attachments

Read this file when a project or task needs files or image references.

## Choose the owner

A task key adds a file to the task. A comment ID adds a file to that comment.
`--project <prefix>` instead of a positional adds a file to the project, for
material that covers the whole project, such as specs and mockups:

```sh
bb my-tasks attachment add --project ABC --file ./spec.pdf
bb my-tasks attachment list --project ABC
```

For a comment attachment, create the comment as JSON and use its ID:

```sh
comment_id=$(
  bb my-tasks comment ABC-12 \
    --body "Screenshot of the failing step." \
    --json | jq -r '.comment.id'
)
bb my-tasks attachment add "$comment_id" --file ./screenshot.png
bb my-tasks attachment add "$comment_id" --file ./trace.log
```

Use JSON output when another command needs returned attachment data.

## Add and remove files

Use repeatable `--attach <path>` with `bb my-tasks create` for initial files.

List IDs with `bb my-tasks attachment list <key>` (the task and its comments)
or `bb my-tasks attachment list --project <prefix>`. Remove a file with
`bb my-tasks attachment remove <attachment-id>`.

The remove command deletes the row and the stored file. It rejects a file
referenced by its task or project description unless `--remove-references`
confirms description cleanup.

## Select a machine

The invoking machine owns `--file`, `--attach`, `--out`, `--description-file`,
and `--body-file` paths. In a thread, this is the thread machine.

Outside a thread, these paths use the server machine. Use
`--machine <id-or-name>` for another enrolled machine.
