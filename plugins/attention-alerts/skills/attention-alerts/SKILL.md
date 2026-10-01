---
name: attention-alerts
description: Inspect, dismiss, and test the user's sticky attention alerts (questions, approvals, plan reviews, errors, finished tasks) and change how they sound and repeat.
---

The Attention alerts plugin raises an alert, with sound, whenever a thread needs the user: a question, an approval, a plan review, an error, or a finished turn. Alerts stack in every bb window and stay until the user handles them.

## Commands

```sh
bb attention-alerts list [--json]
bb attention-alerts dismiss <id> [--json]
bb attention-alerts clear [--json]
bb attention-alerts test [question|approval|plan|error|done] [--json]
```

`list --json` prints `{ "alerts": [{ id, threadId, projectId, interactionId, kind, title, body, createdAt }] }`, newest first. `threadId` is null for test alerts. `body` is null when the title says everything (finished alerts, and errors without a message). `test` defaults to `question`, which also repeats on the reminder interval.

Do not dismiss alerts the user hasn't asked you to clear: they are the user's to-do list.

## Settings

Change with `bb plugin config attention-alerts set <key> <value>`:

| Key | Values | Default |
| --- | --- | --- |
| `alertOnQuestions`, `alertOnErrors`, `alertOnDone` | `true`/`false` | `true` |
| `includeChildThreads` | `true`/`false`: alert when sub-agent threads finish or fail | `false` |
| `sound` | `true`/`false` | `true` |
| `volume` | integer 0–100 | `80` |
| `repeat` | `Off`, `Every minute`, `Every 2 minutes`, `Every 3 minutes`, `Every 5 minutes`, `Every 10 minutes` | `Every 5 minutes` |
| `repeatAllKinds` | `true`/`false`: also repeat errors and finished tasks | `false` |
| `systemNotifications` | `true`/`false` | `true` |
| `macFallback` | `true`/`false`: play on the machine running bb when no window claims the sound | `true` |
| `clearFinishedOnOpen` | `true`/`false` | `true` |

## How alerts clear

Questions, approvals and plan reviews clear when the interaction is no longer pending. Finished and error alerts clear when the thread becomes active again, when the user opens the thread in a focused window, or when a newer result for the thread replaces them. Archiving or deleting a thread clears all of its alerts.

## Troubleshooting

- No sound in a browser tab: the tab needs one click before it can play audio. The desktop app, or the Mac fallback, covers it until then.
- Notifications disappear after a few seconds on macOS: set bb's notification style to **Alerts** in System Settings → Notifications.
- Duplicate notifications: turn off the Push notifications plugin's `webEnabled` and `desktopEnabled`.
- `bb plugin logs attention-alerts` shows fallback and reminder failures.
