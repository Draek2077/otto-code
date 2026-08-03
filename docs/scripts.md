# Scripts

Everything a user can run for a project, behind the Play button.

A **Script** is one runnable command. It comes from one of two places:

- **Declared** — written into the workspace's `otto.json`. Persisted, checked into the repo, and
  the only kind that may own a service-proxy route.
- **Discovered** — read out of the project's own files by a **script provider**
  (`package.json` scripts today). Derived, never persisted, recomputed on every fetch.

Both are Scripts. The originating file's vocabulary does not survive the trip:
`launchSettings.json` calls its entries profiles, Make calls them targets, npm calls them scripts,
and Otto calls all of them Scripts. See [glossary.md](glossary.md).

## The provider contract

`packages/server/src/server/session/workspace-scripts/script-provider.ts`.

```ts
interface ScriptProvider {
  readonly sourceId: string; // "npm" — stable; qualified names are built from it
  readonly sourceLabel: string; // "npm" — the group header's tool half
  discover(context: ScriptDiscoveryContext): Promise<DiscoveredScript[]>;
}
```

Three rules, each one load-bearing:

1. **Detection is discovery.** There is no `detect()` step. A provider whose marker file is absent
   returns `[]`. One code path means detection and discovery cannot disagree.
2. **A provider never throws for a project it does not apply to.** A malformed `package.json` logs
   and yields `[]`. One broken manifest must not blank the whole dropdown, and one provider that
   throws must not take the others with it (`discoverWorkspaceScripts` catches per provider).
3. **A provider is a pure read.** It never writes to the project, never touches `otto.json`, never
   spawns anything.

Adding a source is one file plus one line in `createScriptProviders()`.

## Qualified names

Everything downstream of the dropdown — the runtime store, the service-proxy hostname, the
`workspace.script.*` RPCs — is keyed by `scriptName`, and two sources can both offer `build`. So a
discovered Script's wire name is qualified with its source:

```
npm:build       ← scriptName, the launch/stop key
build           ← label, what the row displays
```

Declared Scripts keep their bare `otto.json` names, so the two namespaces cannot collide. This is
why discovery needed no new RPC and no change to the runtime store: `workspace.script.start.request
{ scriptName: "npm:build" }` flows through the existing handler untouched.

## Discovery is on-demand, never in the descriptor

`WorkspaceDescriptorPayload.scripts` carries exactly what it always did — the declared Scripts plus
any running orphan runtime entry. It is **not** where discovered Scripts live: a monorepo root
`package.json` can hold forty of them, and the descriptor is pushed on every `workspace_update`.

The merged list is fetched instead, over `workspace.script.list` with `includeDiscovered: true`,
when the Scripts dropdown mounts and again whenever it opens (so an edited `package.json` is never
a stale menu).

That leaves two sources of truth in the client, answering different questions, and the split is
deliberate:

| Source                                  | Owns                                            | Stale when             |
| --------------------------------------- | ----------------------------------------------- | ---------------------- |
| The fetched list                        | identity — label, source, command               | something starts/stops |
| The descriptor (`script_status_update`) | status — lifecycle, health, exit code, terminal | a project file changes |

`useWorkspaceScriptGroups` fetches identity once and **overlays status** from the descriptor, field
by field. It does not refetch on `script_status_update`, which arrives on every health poll. The
overlay is explicit rather than a spread: a live orphan record carries no `label` and no `command`,
and spreading it over the fetched record would erase both.

A **running** discovered Script reaches the descriptor only through the orphan path, so
`buildOrphanRuntimePayload` recovers its source from the qualified name — otherwise `npm:dev` leaks
into the sidebar as a script name.

## Coexistence: declared always wins

1. **Declared Scripts sort first** and head the dropdown under an "Otto" group.
2. **Discovery never writes back.** Nothing is ever promoted into `otto.json` behind the user's
   back. Delete a script from `package.json` and it is simply gone.
3. **De-duplication is by command, then by name.** A discovered Script is suppressed when a
   declared one either runs the same normalized command (whitespace collapsed, a trailing `--`
   dropped) or carries the same bare name.

The name rule is the aggressive half, on purpose. `otto.json` is small and hand-authored, so a
declared `dev` _is_ the dev script and must not appear twice. The cost is that a genuinely
different declared `dev` hides `npm run dev`; the escape hatch is renaming the declared entry.

Two _providers_ offering the same bare name do not collide with each other — their qualified names
differ, and they are genuinely different things.

## Running one

Discovered Scripts get the same machinery as declared ones — terminal, runtime store, lifecycle,
exit code, View terminal, Stop, Restart — and **no service-proxy route**.

A proxy route needs a declared port and the intent that the thing serves HTTP.
`package.json` cannot supply either: `npm run dev` might be a server, a watcher, or a one-shot.
Guessing produces dead proxy URLs, which is worse than none. So a discovered Script is always
`type: "script"`. A user who wants a routed URL declares it in `otto.json`.

`spawnWorkspaceScript` takes an optional `resolvedScript` for names `otto.json` will not resolve.
Discovery **re-runs at launch** rather than trusting the name the client last saw, so a Script
deleted from `package.json` since the menu opened fails loudly instead of running a stale command.

## The menu

Discovery turns a five-row menu into a hundred-row one, and a list you cannot search is not more
power, it is less. `script-menu-view.ts` is the pure layer that decides what the dropdown shows.

**Otto's group is expanded and first; every discovered group is collapsed**, its header carrying
the source and a row count so the user can decide whether opening it is worth it. A group header is
hidden only in the pre-discovery shape (one group, always expanded) — a collapsible group must
always show its header, or its rows have nothing to open them.

**Recent** lifts the discovered Scripts this user actually runs into their own expanded group near
the top, capped at `RECENT_SCRIPT_LIMIT`. Without it, recency would be dead weight: ordering rows
inside a group that is collapsed by default only pays off after the user has already opened the
98 rows that were the problem. Otto's declared Scripts are never lifted, since they are already
expanded and first and would appear twice on one screen.

**The filter** appears once the menu reaches `SCRIPT_FILTER_MIN_ROWS`. Below that a user scans
faster than they type. It matches the label _and_ the command, so `vitest` finds every test script
whatever each project named them.

**Filtering and collapsing interact deliberately**, because this is where menus like this usually
go wrong:

| While a query is active              | Why                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------- |
| Every group with a match expands     | A search that hides its own results is useless                         |
| Groups with no match are dropped     | Empty headers are noise                                                |
| The Recent group is withdrawn        | An explicit search wants one flat answer, not a row twice              |
| Stored collapse state is not written | Clearing the field restores the menu they had, not everything expanded |

Ordering, collapse state and run history are **client-side preferences**
(`script-menu-preferences-store.ts`), not project facts. They describe one person's habits at one
workstation, they must never be written into the repo the way an `otto.json` Script is, and on a
shared daemon they would otherwise blend several people's histories into one misleading order.
Keeping them client-side also means recency needs no wire field and no daemon capability.

## Protocol

All additive and optional, per the contract in the root `CLAUDE.md`.

| Field on `WorkspaceScriptPayload` | Absent means            |
| --------------------------------- | ----------------------- |
| `label`                           | display as `scriptName` |
| `source` (`{ id, label, file }`)  | a declared Script       |
| `command`                         | no subtitle             |

`workspace.script.list.request` gains `includeDiscovered` (default `false`), so a client that
predates discovery gets exactly the `otto.json` list it asked for.

Capability gate: `server_info.features.workspaceScriptDiscovery`
(`COMPAT(workspaceScriptDiscovery)`, added in v0.7.6). An older daemon simply does not offer the
grouped list. There is no client-side scan to fall back to — only the daemon can read the
workspace's files.

## Where the code lives

| Piece                     | File                                                             |
| ------------------------- | ---------------------------------------------------------------- |
| The contract              | `server/session/workspace-scripts/script-provider.ts`            |
| The npm provider          | `server/session/workspace-scripts/npm-script-provider.ts`        |
| Registry, merge, de-dup   | `server/session/workspace-scripts/script-discovery.ts`           |
| Discovered wire payloads  | `server/session/workspace-scripts/discovered-script-payloads.ts` |
| Declared wire payloads    | `server/script-status-projection.ts`                             |
| List / launch / stop      | `server/session/workspace-scripts/workspace-scripts-service.ts`  |
| Spawning                  | `server/worktree-bootstrap.ts` (`spawnWorkspaceScript`)          |
| Grouping and the overlay  | `app/screens/workspace/use-workspace-script-groups.ts`           |
| Shared group type + key   | `app/screens/workspace/workspace-script-group.ts` (no React)     |
| Collapse, filter, recency | `app/screens/workspace/script-menu-view.ts` (pure)               |
| Menu preferences          | `app/screens/workspace/script-menu-preferences-store.ts`         |
| The dropdown              | `app/screens/workspace/workspace-scripts-button.tsx`             |

Related: [service-proxy.md](service-proxy.md) for exposing a declared service Script at a public
URL. Open work and the source roadmap:
[projects/script-discovery](../projects/script-discovery/script-discovery.md).
