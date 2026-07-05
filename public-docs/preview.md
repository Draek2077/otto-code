---
title: Preview
description: Let agents start your dev server and verify changes in a real browser tab, with screenshots and inspection instead of "please check manually."
nav: Preview
order: 12
category: Workspaces
---

# Preview

Preview lets an agent start your project's dev server and check its own work in a real browser tab, before telling you it's done. Instead of "I made the change, can you check it looks right," an agent can show you a screenshot, read the console for errors, click through the flow it just built, and confirm the fix actually renders.

## How it works

Preview is two things working together:

- **A dev server it can start and stop.** Configured once per project in `.claude/launch.json`, so the agent (or you) can spin it up on demand instead of you leaving a terminal running.
- **A browser tab it can drive.** Once the server is up, the agent can take a snapshot of the page, inspect an element's computed styles, click a button, fill a form, resize the viewport for mobile/dark-mode checks, and take a screenshot, all without you touching anything.

Every preview server gets one designated browser tab. That tab is tagged with a Play icon so it's easy to tell apart from tabs you opened yourself, and Otto keeps the agent pointed at that same tab rather than letting it wander off and open duplicates of your dev server in new tabs.

## Setting up a project

The first time you use Preview in a project, there's nothing to configure by hand, just ask:

> Detect this project's dev servers and save their configurations to `.claude/launch.json`, then ask which ones to start.

The agent inspects your project, writes `.claude/launch.json` itself, and asks which server(s) to start. From then on, that file is what Preview reads, so it only needs to happen once per project (or once per teammate, if you commit the file).

If you'd rather write it yourself, the format is:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "web",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 3000
    }
  ]
}
```

Add one entry per dev server you want previewable, each with a unique `name` and the `port` it listens on.

## Starting and stopping a server

Two ways to start a configured server:

- **Ask the agent.** It can start, stop, and check logs on a server mid-conversation, e.g. "start the web server and check it for errors" or "the preview shows a blank page, check the server logs."
- **Click the preview button** ("Start preview") in the workspace toolbar, next to New Browser. If the project has one configured server it starts immediately; with more than one, you'll get a quick picker. The tab opens split alongside your chat and shows a spinner until the server responds.

Closing a preview tab does not stop the server by default, the server keeps running so reopening the tab reconnects instantly. If you'd rather have the server shut down whenever its tab is closed, turn on **Preview server on tab close → Stop on close** in Settings → General. There's also **Auto-start on restore**, off by default, which controls whether a previously-open preview tab relaunches its server automatically the next time you open the app, or waits for you to press Start.

## Preview tabs vs. regular browser tabs

A preview tab behaves like any other browser tab, you can navigate it, reload it, resize it, or close it. The differences are:

- It's opened and reconnected by the dev-server lifecycle above rather than a URL you typed.
- Its tab icon is always a Play icon, so it reads as "this is the dev server's surface" at a glance.
- Otto keeps agents from accidentally opening a second, disconnected tab pointed at the same dev server. If an agent (or a "New Browser" click) tries to navigate to a URL that belongs to a running preview server, Otto redirects to the existing preview tab instead of spawning a duplicate.

You can still open ordinary browser tabs to anything else, including that same localhost port manually if you want a second, untracked view of it.

## Turning it on

Preview's browser-driving half rides on Otto's browser tools, which are off by default because they let an agent see and interact with anything in that browser tab, including logged-in sessions. Turn on **Browser tools** under Settings → Host to enable it. Dev-server start/stop/logs work independently of that switch; it's specifically the snapshot/click/fill/screenshot half that needs it.

If you run multiple providers and want to hand Preview to some but not others, open a provider's details and look for its **Otto tools** section: "Preview servers" and "Browser control" can be unchecked per provider, independent of the global switch above (though the global switch always wins if it's off).

## See also

- [Workspaces](/docs/workspaces), how workspaces, sessions, and tabs fit together.
- [Configuration](/docs/configuration), daemon settings and `config.json`.
- [Security](/docs/security), the daemon's broader trust and access model.
