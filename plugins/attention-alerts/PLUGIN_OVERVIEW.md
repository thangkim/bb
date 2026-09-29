Get an alert, with sound, whenever an agent needs you: it asks a question, wants an approval or a plan review, stops on an error, or finishes its task. Alerts stay on screen until you handle them, and several stack on top of each other so you can work through them one by one.

## What you get

- **A stack of cards** in the bottom-right corner of every bb window, newest first. Click a card to open its thread; click × to dismiss it, or use **Dismiss all**.
- **A sound for each new alert**: an urgent chime for questions, approvals and plan reviews, a falling tone for errors, and a soft chime for finished tasks. The sound plays while bb is in the background or minimized, and several alerts arriving together play once.
- **A repeat reminder** while a question, approval or plan review is still waiting: every 1, 2, 3, 5 or 10 minutes, or off.
- **System notifications** while bb is in the background, one per alert, so they pile up in Notification Center instead of replacing each other. They close by themselves when the alert is handled.
- **A Mac fallback**: when no bb window or tab picks an alert up within about 2.5 seconds, the machine running bb plays the sound itself.

## When alerts go away

- Questions, approvals and plan reviews stay until you answer them in the thread.
- Finished and error alerts go away when you open that thread with the window focused, when you send the thread a new message, or when a newer result for the same thread replaces them.
- Archiving or deleting a thread removes its alerts.
- **Dismiss**, **Dismiss all**, or the CLI remove them at any time.

Only one window plays each sound, so several open windows or tabs don't chime together. The desktop app is preferred over browser tabs.

## Settings

- **Questions, approvals and plan reviews** / **Errors** / **Finished tasks**: which events raise an alert. All on by default.
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
- Turn off the Push notifications plugin's web and desktop channels if you use this plugin, or you'll get two notifications for each event.

## CLI

- `bb attention-alerts list [--json]`: open alerts, newest first.
- `bb attention-alerts dismiss <id> [--json]`: dismiss one alert.
- `bb attention-alerts clear [--json]`: dismiss every alert.
- `bb attention-alerts test [question|approval|plan|error|done] [--json]`: raise a test alert with its sound. Run `sleep 5; bb attention-alerts test` and switch apps to try it in the background.
- `bb plugin config attention-alerts set <key> <value>`: change a setting, for example `repeat "Every 2 minutes"`.
