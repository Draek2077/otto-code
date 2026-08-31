---
name: otto-plugin
description: Build and manage trusted local Otto plugins. Use when the user asks to create, edit, install, reload, enable, disable, remove, or troubleshoot a Otto plugin; add a native surface or sidebar item; use Otto from plugin code; add plugin RPCs; or contribute composer attachments.
---

# Otto plugins

Build or manage the requested plugin directly. Use the current public docs to catch contract changes, but keep working from this skill if the network is unavailable.

**User's request:** $ARGUMENTS

## Check current documentation

Fetch [https://otto-code.me/llms.txt](https://otto-code.me/llms.txt) first. Select and fetch the current plugin Markdown pages from that index before changing a plugin:

- [Plugin quickstart](https://otto-code.me/docs/plugins.md) ([browser page](https://otto-code.me/docs/plugins))
- [Plugin reference](https://otto-code.me/docs/plugins/reference.md) ([browser page](https://otto-code.me/docs/plugins/reference))

Use the deployed docs when they disagree with this skill. Do not send the user away to read them instead of completing the work.

When working in the Otto repository, also read `docs/plugins.md` and the relevant example under `plugin-examples/`.

## Create the project

Use an absolute path on the daemon machine. `init` writes files but does not install packages.

```bash
otto plugin init /absolute/path/to/my-plugin
cd /absolute/path/to/my-plugin
npm install
```

The generated project contains:

```text
my-plugin/
  otto-plugin.json
  index.tsx
  otto-plugin.d.ts
  package.json
  tsconfig.json
```

The manifest supplies the default install ID:

```json
{ "id": "my-plugin" }
```

Default-export one contribution function. It must return cleanup, even when there is nothing to clean:

```tsx
import type { PluginContext } from "@otto-code/plugin";

export default function contribute(plugin: PluginContext) {
  // Register contributions here.
  return () => {};
}
```

Cleanup can be async. Use it for timers, watchers, sockets, and other resources created by plugin code. Otto removes registrations, unmounts surfaces, rejects pending RPCs, closes the plugin session, and stops the subprocess when the plugin stops.

## Add a workspace panel

Workspace panels live beside agents, terminals, files, and diffs. Plugins run on desktop and
mobile, and Otto has multiple themes. Every `Text` must take its color from `theme.colors`.
Use `layout.compact` for padding and stacking. Unstyled text is black and fails in dark themes.

```tsx
import {
  type PluginContext,
  type PluginWorkspacePanelProps,
  useWorkspace,
} from "@otto-code/plugin";
import { useMemo } from "react";
import { Text, View } from "react-native";

function Overview({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const name = useWorkspace(workspaceId, (workspace) => workspace.name);
  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        padding: layout.compact ? 16 : 24,
        gap: layout.compact ? 8 : 12,
        backgroundColor: theme.colors.surface0,
      },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 20 : 24 },
    }),
    [theme, layout.compact],
  );
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{name}</Text>
    </View>
  );
}

export default function contribute(plugin: PluginContext) {
  plugin.addWorkspacePanel({
    id: "overview",
    title: "Workspace overview",
    icon: "PanelsTopLeft",
    context: "workspace",
    Component: Overview,
  });
  plugin.addCommandCenterItem({
    id: "open-overview",
    title: "Open workspace overview",
    icon: "PanelsTopLeft",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("overview");
    },
  });
  return () => {};
}
```

Use `useWorkspace(id, selector)` and `useAgent(id, selector)`. Selectors are required
and their results use shallow equality. Never select the whole snapshot or add an RPC to discover
the active workspace or agent. Command callbacks receive the selected host's `otto`, typed
`rpc(contract, input)`, `openSurface(id)`, and contextual `openPanel(id)` capabilities.

## Add a sidebar surface

Plugin surfaces use React Native primitives and work across desktop, browser, iOS, and Android. Register the surface before its sidebar item. Color text from `theme.colors` and pad from `layout.compact`.

```tsx
import type { PluginContext, PluginSurfaceProps } from "@otto-code/plugin";
import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

function Counter({ theme, layout }: PluginSurfaceProps) {
  const [count, setCount] = useState(0);
  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        padding: layout.compact ? 16 : 24,
        gap: 16,
        backgroundColor: theme.colors.surface0,
      },
      count: { color: theme.colors.foreground, fontSize: layout.compact ? 36 : 48 },
      button: { padding: 14, borderRadius: 10, backgroundColor: theme.colors.accent },
      buttonText: { color: theme.colors.accentForeground, textAlign: "center" as const },
    }),
    [theme, layout.compact],
  );
  return (
    <View style={styles.screen}>
      <Text style={styles.count}>{count}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increment counter, currently ${count}`}
        onPress={() => setCount((value) => value + 1)}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Count me in</Text>
      </Pressable>
    </View>
  );
}

export default function contribute(plugin: PluginContext) {
  plugin.addSurface("main", Counter);
  plugin.addSidebarItem({
    id: "main",
    title: "Counter",
    icon: "ListPlus",
    surface: "main",
  });
  return () => {};
}
```

Icons are Lucide icon names. `theme` is a typed `PluginTheme` on every surface and panel. Primary text uses `theme.colors.foreground`; labels use `theme.colors.foregroundMuted`; the root view uses `theme.colors.surface0`. `layout.compact` is true on mobile and narrow windows. Otto owns the route, header, host picker, close action, error boundary, and per-installation query client.

Client code may import `react`, `react-native`, `@tanstack/react-query`, `zod`, `@otto-code/plugin`, and `@otto-code/plugin/server`. Install dependencies locally for typechecking; Otto supplies these runtime modules.

| Module                     | Use it for                                           |
| -------------------------- | ---------------------------------------------------- |
| `@otto-code/plugin`        | hooks and UI types                                   |
| `@otto-code/plugin/server` | `defineRpc`, `defineAttachmentSource`, handler types |

## Choose the correct API

Use the existing Otto SDK for normal Otto operations. Use plugin RPC only for plugin-specific backend behavior.

### Call Otto from a surface

`useOtto()` borrows the selected host's current connection. Never create another client inside a surface.

```tsx
import { useOtto } from "@otto-code/plugin";

function PullRequestAction() {
  const otto = useOtto();

  async function createReviewWorkspace() {
    const workspace = await otto.workspaces.create({
      title: "Review PR 42",
      source: {
        kind: "worktree",
        cwd: "/absolute/path/to/repository",
        action: "checkout",
        checkoutSource: { kind: "change_request", forge: "github", number: 42 },
      },
    });
    await workspace.agents.create({
      config: { provider: "codex/gpt-5.5" },
      prompt: "Review PR #42.",
    });
  }

  // Wire createReviewWorkspace to a Pressable.
  return null;
}
```

The API covers workspaces, agents, providers, and daemon config. It omits connection lifecycle because Otto owns the connection. Consult the current [SDK reference](https://otto-code.me/docs/sdk/reference.md) for method details.

### Add daemon-side behavior

Define one Zod contract, register its subprocess handler, and call it with `useRpc()`:

```tsx
import type { PluginContext } from "@otto-code/plugin";
import { useRpc } from "@otto-code/plugin";
import { defineRpc } from "@otto-code/plugin/server";
import { z } from "zod";

const greeting = defineRpc({
  name: "greeting.create",
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
});

function Greeting() {
  const createGreeting = useRpc(greeting);
  // Use createGreeting({ name: "Ada" }) in a query, mutation, or event.
  return null;
}

export default function contribute(plugin: PluginContext) {
  plugin.handle(greeting, async ({ name }, { otto }) => {
    const { config } = await otto.config.get();
    return { message: `${name}: plugins are ${config.pluginsEnabled ? "on" : "off"}` };
  });
  plugin.addSurface("main", Greeting);
  return () => {};
}
```

Inputs and outputs are validated on both sides. Backend handlers receive the same `OttoApi` as `{ otto }`; their IPC-backed daemon session lives exactly as long as the subprocess. Backend code can use Node APIs and installed dependencies. Keep credentials, filesystem access, shell commands, and vendor API calls in the handler rather than the client surface.

Use TanStack Query for async request state, caching, and mutations.

### Debug daemon-side behavior

Backend contributions can use normal Node logging. `console.log()` writes to the plugin's stdout;
`console.error()` writes to stderr. Otto captures both streams without interfering with plugin IPC.

Inspect recent output after install, reload, an RPC failure, or a subprocess crash:

```bash
otto plugin logs my-plugin
otto plugin logs my-plugin --json
otto plugin logs my-plugin --host <url>
```

The same tail is available from **Settings → Plugins → Logs**. It includes initialization, handler,
cleanup, and final crash output. Reload, disable, and process failure retain the tail. Removing the
plugin clears it; restarting the daemon clears the in-memory tail. Structured copies also go to the
daemon log. Never log credentials or other secrets.

## Add a composer attachment source

Define a search RPC and register a declarative source:

```tsx
import type { PluginContext } from "@otto-code/plugin";
import { defineAttachmentSource, defineRpc } from "@otto-code/plugin/server";
import { z } from "zod";

const searchIssues = defineRpc({
  name: "issues.search",
  input: z.object({ query: z.string() }),
  output: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        identifier: z.string(),
        title: z.string(),
        subtitle: z.string().optional(),
        url: z.string().url(),
        text: z.string(),
        resourceType: z.string(),
      }),
    ),
  }),
});

const issues = defineAttachmentSource({
  id: "issues",
  title: "Acme issue",
  icon: "CircleDot",
  pickerTitle: "Attach Acme issue",
  searchPlaceholder: "Search by identifier or title",
  search: searchIssues,
});

export default function contribute(plugin: PluginContext) {
  plugin.handle(searchIssues, ({ query }) => searchAcmeIssues(query));
  plugin.addAttachmentSource(issues);
  return () => {};
}
```

Return complete text snapshots. Otto owns the composer menu, picker, pills, drafts, and submission. Credentials and vendor calls stay in the daemon handler.

## Hosts and trust

Plugins are installed per daemon and are trusted, unsandboxed code. Backend code can access files, processes, credentials, and network services on the daemon machine. Client contributions run inside the Otto app. Do not install a plugin the user has not authorized or source code you have not inspected.

### Check the global switch before installing

Identify the target daemon and inspect its root `pluginsEnabled` value in `config.json`. For the local daemon, `otto daemon status --json` reports its `home`; the file is `<home>/config.json`. Treat a missing field as `false`. Do not infer the global value from a plugin's `disabled` status, because an individual plugin can also be disabled.

If `pluginsEnabled` is already `true`, continue without asking the user to enable it.

If it is false or absent, stop and ask the user for explicit permission before editing or enabling anything. Include this warning in the request:

> Plugins are trusted, unsandboxed code. Backend plugin code can access your daemon machine, including files, processes, credentials, and network services. Client plugin code runs inside the Otto app. May I enable plugins on this daemon?

Do not continue unless the user agrees. After permission:

1. Preserve the rest of `config.json` and set the root `pluginsEnabled` field to `true`.
2. Run `otto reload --json` against that daemon.
3. Require `pluginsEnabled` in `appliedPaths`, or accept an empty `appliedPaths` only after re-reading the file and confirming the live plugin catalog is enabled.
4. Run `otto plugin ls` and verify the intended plugin reaches `running` after installation.

If the user asks to disable the global switch, set `pluginsEnabled` to `false`, run `otto reload --json`, and verify configured plugins report `disabled`.

Do not edit a local config when the target is a remote daemon. Perform the edit on the daemon machine, or ask the user to use **Settings → Plugins → Enable plugins**. `otto reload --host <url>` reloads the remote daemon's own file but does not edit it.

When the same sidebar contribution exists on several connected hosts, Otto shows it once with a host picker. The selected host owns the bundle, SDK calls, RPCs, and query cache. An offline selected host does not fall through to another host. Attachment sources stay scoped to the composer's host.

## Typecheck and manage

Always typecheck before install or reload:

```bash
npm run typecheck
otto plugin install /absolute/path/to/plugin
otto plugin install /absolute/path/to/plugin --id another-runtime-id
otto plugin ls
otto plugin reload my-plugin
otto plugin logs my-plugin
otto plugin disable my-plugin
otto plugin enable my-plugin
otto plugin remove my-plugin
```

Use `--host <url>` when managing a daemon other than the CLI default. Plugin source edits require `otto plugin reload`; config changes to the global switch require `otto reload`. A failed plugin reload stays failed; inspect `otto plugin ls` for the load error and `otto plugin logs <id>` for subprocess output, fix the source, typecheck, and reload again. `remove` deletes configuration, never the source directory.

Do not restart the daemon to load source changes. Restarting it can kill the agent performing the work.

## Verify the outcome

After a change:

1. Run `npm run typecheck`.
2. Install or reload the exact runtime ID.
3. Run `otto plugin ls` and require `running` with no error.
4. Confirm the contribution on the intended host. Open the Command Center with **⌘K** (macOS) or **Ctrl+K** (Windows/Linux). For UI work, check a wide desktop window and a compact/mobile client, and switch theme to confirm text still uses `foreground` / `foregroundMuted`.
5. Exercise the changed action or RPC, including its error state.

Common failures:

- Missing sidebar item: wrong host, plugin not `running`, invalid Lucide icon, or sidebar item points to a missing surface.
- Unavailable client module: client bundles can use only the host-provided modules listed above.
- RPC rejection: input or output failed its Zod schema, or the handler threw. Inspect `otto plugin logs <id>` for handler output.
- Plugin exits or reload fails: inspect `otto plugin ls` for status and `otto plugin logs <id>` for initialization, cleanup, or crash output.
- Stale UI: source was edited without `otto plugin reload <id>`.
