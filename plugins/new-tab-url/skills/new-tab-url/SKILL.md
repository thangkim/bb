---
name: new-tab-url
description: "Explain or diagnose the New tab URL plugin, which opens a link typed or pasted into the side panel's new-tab search when you press Enter."
---

# New tab URL

The side panel's new-tab page has one search box for files and actions. With
this plugin, paste or type a link there and press Enter: bb opens it in the
browser instead of searching files.

## What counts as a link

- Anything starting with `http://` or `https://`.
- `localhost` or an IPv4 address, with an optional port and path. These open
  over `http://`.
- A host starting with `www.`, or a host ending in a common domain such as
  `.com`, `.org`, `.net`, `.io`, `.dev`, `.app`, `.ai`, `.co`, `.so`, `.me`,
  `.xyz` or `.vn`. These open over `https://`.

Anything else, such as `app.tsx` or `src/index.ts`, stays a file search. Only
a plain Enter counts; Cmd, Ctrl, Alt and Shift with Enter are left to bb.

The plugin has no settings, commands, or agent tools. Install it with
`bb plugin install ./plugins/new-tab-url` and toggle it with
`bb plugin enable|disable new-tab-url`.

## Diagnosing

- Enter does nothing on a link: the plugin is disabled, or the text is not
  recognized as a link (see above).
- The link opens outside bb: the plugin uses bb's open-links preference, so
  turn on opening links in bb's browser in settings.
- Nothing happens when the thread composer is hidden: the plugin attaches
  through a composer banner, which only exists while a composer is mounted.

The plugin finds the search box as the `combobox` input inside
`[data-panel-new-tab-page]`. A bb release that changes that markup needs a
plugin update.
