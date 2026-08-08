---
id: "script-discovery"
kind: "project"
title: "Script Discovery"
status: "confirmed"
tags: ["project-charter", "legacy-projects-migration"]
delivery_status: "in_build"
created_at: "2026-08-08T06:17:59.004Z"
updated_at: "2026-08-08T06:19:50.625Z"
---

# Script Discovery

<!-- compiled_truth -->

# Script discovery - every runnable thing a project already has

**Status:** In build. Slice 1 (the provider abstraction + npm, end to end) is built and dogfooded;
see [What dogfooding slice 1 found](#what-dogfooding-slice-1-found) for what it turned up and what
must happen next.

## The problem

Otto's **Scripts** dropdown shows exactly one thing: what somebody wrote into `otto.json`. That
file is Otto's own JetBrains-`.idea` equivalent, and declaring a run configuration there is a real
feature. But it is also the only way a project tells Otto how to run itself, and that is wrong,
because every project already carries that knowledge:

| Project shape         | Where the runnables already live                              |
| --------------------- | ------------------------------------------------------------- |
| Node                  | `package.json` → `scripts`                                    |
| .NET                  | `.sln`/`.slnx` → `.csproj` → `Properties/launchSettings.json` |
| Make                  | `Makefile` targets                                            |
| Rust                  | `Cargo.toml` bins and examples                                |
| Python                | `pyproject.toml` scripts, `uv`/`poetry` entry points          |
| Compose               | `docker-compose.yml` services                                 |
| VS Code compatibility | `.vscode/tasks.json`, `.vscode/launch.json`                   |

A user opening a project in Otto sees an empty Play button and is told, in effect, to re-declare
what `package.json` already says. Every other IDE reads these and offers them. So should we, and
per the fork's mission it should be one abstraction that all sources plug into, not a special case
for npm.

**The point of this initiative is user power.** Otto today is very good at letting an _agent_ run
things. The Play button is where the _user_ runs things, and it is starved.

## 1. The unifying concept

The user's own framing is the answer: every one of these is **a thing you can run for this
project**. There is one noun for it, and per [docs/glossary.md](../../docs/glossary.md) the
existing UI label wins:

> **Script** - one runnable command a project offers. UI label: **Scripts** (the Play button and
> its dropdown). Never "runnable", "task", "run configuration", "target", or "launch profile" in
> UI copy, no matter what the originating file calls it.

That is deliberate. `launchSettings.json` calls its entries profiles, Make calls them targets, npm
calls them scripts. Inside Otto they are all Scripts. The _source_ is what differs, and the source
is surfaced as a group header, not as a second noun:

```
Scripts
├── Otto                    ← otto.json, declared and persisted
│   ├── dev
│   └── daemon
├── npm · package.json      ← discovered
│   ├── build
│   ├── typecheck
│   └── lint
└── Make · Makefile         ← discovered (later slice)
    └── release
```

Second term, needed because the grouping is a real concept:

> **Script source** - where a Script came from. Either **Otto** (declared in `otto.json`) or a
> discovery provider named after the tool and its file (`npm · package.json`).

## 2. What a provider is

A **script provider** scans a workspace directory and returns the Scripts its ecosystem declares.
It is a pure read: it never writes to the project, never mutates `otto.json`, and never spawns
anything.

```ts
interface ScriptProvider {
  readonly sourceId: string; // "npm", "make", "dotnet" - stable, appears in qualified names
  readonly sourceLabel: string; // "npm" - the group header's tool half
  discover(context: ScriptDiscoveryContext): Promise<DiscoveredScript[]>;
}

interface ScriptDiscoveryContext {
  workspaceDirectory: string;
  logger: Logger;
}

interface DiscoveredScript {
  name: string; // as the project calls it: "build"
  command: string; // what actually runs: "npm run build"
  cwd: string | null; // relative to the workspace root; null = the root itself
  sourceFile: string; // repo-relative, for the subtitle: "package.json"
}
```

Three rules make this contract survivable:

1. **Detection is discovery.** No separate `detect()` step. A provider whose marker file is absent
   returns `[]`, cheaply. One code path, no way for detect and discover to disagree.
2. **A provider never throws for a project it does not apply to.** Malformed `package.json` logs
   and yields `[]`; it does not fail the whole list. One broken manifest must not blank the
   dropdown.
3. **Discovery is on-demand, never in the workspace descriptor.** The descriptor's `scripts` array
   stays exactly what it is today (Otto's declared set plus running orphans) so `workspace_update`
   does not grow by the ~40 entries a monorepo root `package.json` carries. The merged list is
   fetched over `workspace.script.list` when the dropdown opens.

### Identity: qualified names

Everything downstream of the dropdown - the runtime store, the service-proxy hostname, the
start/stop RPCs - is keyed by `scriptName`. Two sources can both offer `build`, so a discovered
Script's wire name is qualified:

```
npm:build     sourceId ":" the project's own name
```

The unqualified name rides in a new optional `label` field for display. This is the key decision
that keeps the slice small: **no new RPC, no new key concept, no change to the runtime store.**
`workspace.script.start.request { scriptName: "npm:build" }` flows through the existing handler
untouched. A colon cannot appear in an `otto.json` script name that also parses as a known
`sourceId`, and Otto's own scripts keep bare names, so the two namespaces cannot collide.

## 3. What ships in slice 1

**npm / `package.json` at the workspace root.** Nothing else.

It is the right proof because this repo _is_ a node monorepo, so it is dogfooded the moment it
lands, and because `package.json` is the highest-population source in the wild. The abstraction is
the deliverable; npm is the evidence it works.

Charter-only, in rough order of value:

- **npm workspaces** - packages' own `package.json` scripts, grouped per package.
- **Make** - `Makefile` targets (needs `.PHONY` parsing to avoid offering file rules).
- **.NET** - `.sln`/`.slnx` → `.csproj` → `launchSettings.json` profiles. The heaviest, and the one
  the user called out; it wants the [Solution view](../../docs/solution-view.md) sidecar rather
  than a hand-rolled MSBuild reader.
- **Compose**, **Cargo**, **pyproject**, **`.vscode/tasks.json`**.

## 4. Coexistence with Otto's own Scripts

Otto's Scripts are **declared**; discovered ones are **derived**. Three rules:

1. **Otto always wins, and always sorts first.** Its group is at the top of the dropdown.
2. **Discovery never writes back.** A discovered Script is never persisted into `otto.json`. It is
   recomputed from the project files every time the list is fetched. If the user deletes it from
   `package.json`, it is gone; there is no stale Otto copy to clean up.
3. **De-duplication is by command, then by name.** A discovered Script is suppressed when an Otto
   Script either
   - runs the same normalized command (whitespace collapsed, a trailing `--` dropped), or
   - carries the same bare name.

   The name rule is the aggressive half and it is deliberate: `otto.json` is small and
   hand-authored, so if you named a Script `dev` you meant _the_ dev script, and the user's stated
   requirement is that it must not appear twice. The cost is that a genuinely different Otto `dev`
   hides `npm run dev`; the escape hatch is renaming the Otto entry.

**Deferred:** a "Pin to otto.json" action that promotes a discovered Script into a declared one,
so it can gain a port, a service route and a proxy URL. That is the natural bridge between the two
halves and it is out of slice 1.

## 5. What happens on run

Discovered Scripts get **the same runtime machinery** - the terminal, the runtime store, lifecycle
tracking, exit codes, View terminal, Stop, Restart - and **no service-proxy route**.

The tradeoff, stated plainly:

- **Why the same machinery.** A Script is a terminal ([`workspace-scripts are terminals`]
  precedent). Running a discovered Script through a second, simpler path would mean two lifecycle
  models, two ways to be "running", and a Stop button that works for one kind and not the other.
  The runtime store is already keyed by `(workspaceId, scriptName)` and qualified names slot into
  it for free.
- **Why no service proxy.** A proxy route needs a declared port and the _intent_ that this thing
  serves HTTP. `package.json` cannot tell us either - `npm run dev` might be a server, a watcher,
  or a one-shot. Guessing produces dead proxy URLs, which is worse than none. So a discovered
  Script is always `type: "script"`, and a user who wants a proxied URL declares it in `otto.json`
  (or, later, pins it).

The one daemon change this needs: `spawnWorkspaceScript` currently resolves the command by looking
the name up in `otto.json` and throws if it is absent. It gains an optional resolved-command
parameter for names it will not find there.

## Protocol changes

All additive, all optional, per the root `CLAUDE.md` contract.

`WorkspaceScriptPayloadSchema` gains:

| Field     | Type                    | Absent means            |
| --------- | ----------------------- | ----------------------- |
| `label`   | `string?`               | display as `scriptName` |
| `source`  | `{ id, label, file? }?` | an Otto script          |
| `command` | `string \| null?`       | unknown - no subtitle   |

`workspace.script.list.request` gains `includeDiscovered: boolean?` (default `false`), so an old
client's list call returns exactly what it returns today.

Capability gate: `server_info.features.workspaceScriptDiscovery`. An old daemon simply does not
offer the grouped list - no fallback path, no client-side scanning.

## Test plan

- Discovery scanner against a **real** temp filesystem: a `package.json` with scripts, one without
  a `scripts` key, malformed JSON, a missing file, and non-string script values.
- De-dup: command match, name match, and the negative case (different name and command ⇒ both
  shown).
- Payload assembly: discovered entries carry `label`/`source`/`command`, Otto entries do not gain
  a `source`, and Otto sorts first.
- Launch: starting a qualified name that is absent from `otto.json` reaches the terminal with the
  resolved command.

## What dogfooding slice 1 found

Run against this repo's own root `package.json`: **103 discovered Scripts**, npm correctly
detected from `package-lock.json`, and a declared `daemon` correctly suppressing `npm run daemon`.

Two conclusions:

1. **Keeping discovery out of the workspace descriptor was right.** 103 entries on every
   `workspace_update` would have been a real cost for a payload that is pushed constantly.
2. **A 103-row dropdown is not a usable menu.** This became the next slice, ahead of any additional
   source, and it has shipped: collapse-by-default, a **Recent** group, and a filter above
   `SCRIPT_FILTER_MIN_ROWS`. First open of this repo's menu is now **5 rows** (the `otto.json` set)
   under two group headers, down from 103. See [docs/scripts.md](../../docs/scripts.md#the-menu).

   **Pinning was deliberately not built.** It is manual curation, and this menu already has two
   automatic forms of it: `otto.json` (authored, always first and expanded) and Recent (earned by
   use). A third, hand-maintained list would compete with both and go stale. If Recent proves too
   volatile in real use - a one-off `npm run something` evicting a daily driver - pinning is the
   answer, but that is a measurement, not an assumption.

## Out of scope

Editing `package.json`, creating Scripts from the UI, run arguments/env prompts, debugging
(attaching a debugger to a launch profile), and per-source enable/disable settings. All of these
are real; none belongs in the first slice.

## Timeline

- time: "2026-08-08T06:17:59.004Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:17:59.004Z"
  kind: "evidence"
  summary: "Migrated from `projects/script-discovery/script-discovery.md` and the legacy `projects/README.md` ledger. Legacy status: In build. Ledger summary: Every runnable thing a project already declares, surfaced in the **Scripts** dropdown under group headers naming its source. One **script provider** contract (scan a workspace root, return entries; detection _is_ discovery, a provider that does not apply returns `[]`), qualified wire names (`npm:build`) so the existing runtime store and `workspace.script.*` RPCs carry discovered entries with no new key concept, and on-demand fetch so the workspace descriptor never grows by a monorepo's ~40 scripts. Otto's `otto.json` Scripts stay authoritative, sort first, and suppress a discovered duplicate by normalized command **or** bare name; discovery never writes back. Discovered Scripts get the full terminal/lifecycle machinery but **no service-proxy route** - `package.json` cannot say whether `npm run dev` serves HTTP, and a dead proxy URL is worse than none. **Slice 1 (built):** the abstraction + npm/`package.json` at the workspace root. Dogfooded on this repo: **103 Scripts discovered**, npm detected from the lockfile, declared entries correctly suppressing their duplicates. **Next, and ahead of any new source:** a 103-row menu is not usable - collapse discovered groups by default, filter above ~10 entries, pinning, recency ordering. Adding sources before that lands makes the menu worse. **Then:** npm workspaces, Make, then .NET `launchSettings.json` profiles via the [solution-view](solution-view/solution-view.md) sidecar; then Compose, Cargo, pyproject, `.vscode/tasks.json`. **Deferred:** \"Pin to `otto.json`\" to promote a discovered Script into a declared one that can hold a port and a proxy route. Distinct from [toolchain-catalog](toolchain-catalog/toolchain-catalog.md), which asks what the _machine_ can do, not what the _project_ offers"
- time: "2026-08-08T06:19:50.625Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
