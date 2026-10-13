Get an alert, with sound, whenever an agent needs you: it asks a question, wants an approval or a plan review, stops on an error, or finishes its task, and when a terminal in a thread finishes its work. Alerts stay on screen until you handle them, and several stack on top of each other so you can work through them one by one.

## What you get

- **A stack of cards** in the bottom-right corner of every bb window, newest first. Click a card to open its thread (a terminal alert also opens that terminal in the right panel); click × to dismiss it, or use **Dismiss all**.
- **Titles that say what happened**: a finished thread called "Summarize the blog post" shows "Summarized the blog post", and a failed one shows "Failed to summarize the blog post". Titles that don't start with a verb read "Finished “…”" or "Failed: …". The icon's color shows the status: amber when the agent is waiting for you, red for errors, green when done. A second line appears only when it adds something: the question, the command to approve, or the error message.
- **A sound for each new alert**: an urgent chime for questions, approvals and plan reviews, a falling tone for errors, and a soft chime for finished tasks. The sound plays while bb is in the background or minimized, and several alerts arriving together play once.
- **A repeat reminder** while a question, approval or plan review is still waiting: every 1, 2, 3, 5 or 10 minutes, or off.
- **System notifications** while bb is in the background, one per alert, so they pile up in Notification Center instead of replacing each other. They close by themselves when the alert is handled.
- **Terminal alerts**: type into a thread's terminal, for example a prompt to Claude Code or Codex, or a build command. When the terminal has produced output for at least 5 seconds and then stays quiet for 4, you get "Terminal finished: <name>". The name comes from the title the program sets, so Claude Code shows its task name. A bell or an OSC 9/777 notification from the program raises the alert straight away, with its message.
- **A Mac fallback**: when no bb window or tab picks an alert up within about 2.5 seconds, the machine running bb plays the sound itself.

## When alerts go away

- Questions, approvals and plan reviews stay until you answer them in the thread.
- Terminal alerts go away as soon as you type into or focus that terminal.
- Finished and error alerts go away when you open that thread with the window focused, when you send the thread a new message, or when a newer result for the same thread replaces them.
- Archiving or deleting a thread removes its alerts.
- **Dismiss**, **Dismiss all**, or the CLI remove them at any time.

Only one window plays each sound, so several open windows or tabs don't chime together. The desktop app is preferred over browser tabs.

## Settings

- **Questions, approvals and plan reviews** / **Errors** / **Finished tasks**: which events raise an alert. All on by default.
- **Terminals finishing**: on by default.
- **Sub-agent threads finishing or failing**: off by default. Questions from sub-agent threads always alert.
- **Play a sound**, **Volume** (0–100, default 80).
- **Repeat the sound while waiting**: Off, or every 1, 2, 3, 5 (default) or 10 minutes.
- **Also repeat for errors and finished tasks**: off by default.
- **System notifications**: on by default.
- **Play on this Mac when no bb window is open**: on by default.
- **Clear finished and error alerts when you open the thread**: on by default.

The settings page also has **Allow system notifications**, **Play test sound** and **Raise test alert** for the device you're on.

## Making notifications stay on screen (macOS)

macOS decides how long a banner stays. Open System Settings → Notifications → bb and choose **Alerts** instead of **Banners**, so each notification stays until you click or close it. Browsers follow the same system setting for their own app.

## Limits

- Sound and notifications need bb running. With every window closed, only the Mac fallback sound plays; the cards and notifications appear once you open bb again.
- A browser tab can only play sound after you have clicked somewhere in it once. Until then the desktop app or the Mac plays it.
- Terminal alerts only cover terminals that belong to a thread, and are a guess from output timing: a program that pauses for a few seconds mid-answer, or waits for a permission prompt, also counts as finished.
- Turn off the Push notifications plugin's web and desktop channels if you use this plugin, or you'll get two notifications for each event.

## CLI

- `bb attention-alerts list [--json]`: open alerts, newest first.
- `bb attention-alerts dismiss <id> [--json]`: dismiss one alert.
- `bb attention-alerts clear [--json]`: dismiss every alert.
- `bb attention-alerts test [question|approval|plan|error|done] [--json]`: raise a test alert with its sound. Run `sleep 5; bb attention-alerts test` and switch apps to try it in the background.
- `bb plugin config attention-alerts set <key> <value>`: change a setting, for example `repeat "Every 2 minutes"`.
