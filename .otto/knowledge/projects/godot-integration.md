---
id: "godot-integration"
kind: "project"
title: "Godot Integration"
status: "confirmed"
tags: ["project-charter", "legacy-projects-migration"]
delivery_status: "charter"
created_at: "2026-08-08T06:17:54.761Z"
updated_at: "2026-08-08T06:19:46.699Z"
---

# Godot Integration

<!-- compiled_truth -->

# Godot integration - a game engine whose whole project is diffable text

## Why Godot specifically

Most game engines are hostile to a tool like Otto. Unity serializes scenes to YAML with GUID
references that make a diff unreadable; Unreal's assets are binary. Review, blame and file history
degrade to "someone changed something".

Godot is the exception. A project is a directory containing `project.godot`, and **every part of it is
plain text**: scenes (`.tscn`), resources (`.tres`), scripts (`.gd`), shaders (`.gdshader`), and the
project file itself. That single property means most of Otto already works on a Godot project the day
someone points it at one - Changes shows a real diff, blame attributes a real line, file history
works, an agent can read and edit a scene.

The second reason is scripting: Godot supports **C#**, which the LSP registry already has a row for.
A C# Godot project is a `.csproj` with the Godot SDK, so go-to-definition, references and rename land
on the gameplay code without new language support.

So the question is not "can Otto support Godot" but "what is missing that stops it feeling
first-class", and the list is shorter than it is for any other engine.

## What is missing

### 1. File formats

| Extension        | What it is            | Needs                                    |
| ---------------- | --------------------- | ---------------------------------------- |
| `.gd`            | GDScript              | Grammar, indentation rules               |
| `.tscn`          | Scene                 | Grammar; ideally a structured view       |
| `.tres` / `.res` | Resource              | Grammar                                  |
| `.gdshader`      | Shading language      | Grammar                                  |
| `project.godot`  | Project manifest      | Grammar; doubles as the project marker   |
| `.import`        | Asset import settings | Grammar; usually noise, worth collapsing |

`.tscn` and `.tres` use a custom INI-like format - sections in square brackets with typed values and
`ExtResource`/`SubResource` references. It resembles INI and TOML without being either, and a
near-miss grammar reads worse than none, so this wants to be its own grammar rather than a coerced
existing one.

`.import` files are generated and sit beside every asset. They are legitimate project content but
almost never what someone wants to read; the file tree should treat them the way it treats lockfiles.

### 2. The language server does not fit the registry

This is the one real architectural obstacle, and it is worth stating precisely.

Every row in `packages/server/src/server/lsp/registry.ts` spawns a **stdio child process** that Otto
owns for the lifetime of the session. Godot's GDScript language server is different in kind: it is
hosted **inside the running Godot editor** and speaks LSP over a **TCP socket**. Otto cannot spawn it,
does not own its lifetime, and has to connect to something that may or may not be running.

That forces three changes:

- The registry grows a **transport** field - `stdio` today, `socket` for this.
- The pool learns to **attach to a socket** rather than own a child, including reconnect when the
  editor restarts and a clear degraded state when it is not running.
- The UI needs an honest story for "the language server needs the Godot editor open", because that is
  a genuinely unusual requirement and silence would read as a bug.

**Unverified.** The default port, whether it is configurable, and the exact handshake all need
checking against a current Godot build before this is planned in detail. Do not design against a
remembered port number.

The C# path has no such problem - it is the existing `csharp` row, unchanged.

### 3. Build, export and run

Godot has a headless mode intended for CI, which is the hook for building and exporting without the
editor GUI. That is what a `build` entry in the [toolchain catalog](../toolchain-catalog/toolchain-catalog.md)
would call, and what a workspace script would run.

**Unverified.** The exact flags for headless build, C# solution build, and export need checking. They
have changed across Godot 3 → 4 and should not be written from memory.

### 4. Preview - the interesting one

Godot's **web export** produces a browser-runnable build. If that holds, Otto's existing browser pane
could run and verify a game with **no new preview infrastructure at all** - the same accessibility
snapshots, console capture, click/fill, viewport resize and screenshots that
[preview](../../docs/preview.md) already provides for a web app, pointed at a game.

That would be an unusually strong story: an agent changes a gameplay script, exports, and shows a
screenshot of the running game as proof rather than asking the user to check.

**Speculative until someone tries it.** Web export needs specific export templates installed, has
threading and `SharedArrayBuffer` requirements that imply COOP/COEP headers, and the canvas may be
opaque to the accessibility snapshot even when it renders. Any of those could turn "free" into "a
project of its own". **This is the first thing to test**, because it decides whether Godot support is
a nice-to-have or a headline.

## Sequence

1. **Verify the three unknowns.** The LSP transport and port, the headless build flags, and whether a
   web export actually runs and is inspectable in Otto's browser pane. Cheap, and it decides the shape
   of everything after it.
2. **File formats.** Grammars for `.gd`, `.tscn`, `.tres`, `.gdshader`, `project.godot`. Independent
   of everything else, immediately useful, and enough on its own to make Otto pleasant on a Godot repo.
3. **Project support.** `project.godot` as a project marker so the explorer shows a Godot project
   rather than a folder - a catalog row, per [toolchain-catalog](../toolchain-catalog/toolchain-catalog.md).
4. **Socket transport for the LSP pool.** The real work. Justified by GDScript, and reusable by any
   other server that hosts rather than spawns.
5. **Build and export**, via catalog entries and workspace scripts.
6. **Preview**, if step 1 says it is real.

Steps 2 and 3 deliver most of the felt value and need none of the architecture in 4.

## Design rules

1. **Do not build a scene editor.** Otto is a coding environment. Godot's own editor is where scenes
   get authored; Otto's job is the code, the diff, the review and the agent loop around them. The
   moment this charter grows a node-graph UI it has lost.
2. **The editor may not be running.** Every feature states what it does when Godot is closed. The LSP
   degrades; grammars, diffs, blame and history do not depend on it at all.
3. **Godot 4 is the target.** Godot 3 differs enough in project format and CLI flags that supporting
   both doubles the surface for a shrinking audience. Detect and say so rather than half-working.
4. **C# and GDScript are both first-class.** C# is nearly free and GDScript is the majority of real
   projects; shipping only the easy one would be shipping the wrong one.

## Open questions

- **Does the web-export preview actually work end to end?** Everything about how ambitious this
  charter should be hangs on it. Test before planning further.
- **Is a structured `.tscn` view worth building?** A scene is a node tree, and rendering it as a tree
  rather than text would be genuinely better for review. It is also a bespoke viewer for one format,
  which is how scope gets away from a charter. Probably a follow-on, decided after the grammar ships.
- **Do generated files get hidden or shown?** `.import` files and `.godot/` are project content that
  nobody reads. There is an existing question here about how the explorer treats generated content;
  Godot should adopt that answer rather than invent one.
- **Which Godot install does Otto use?** Godot is commonly a standalone download rather than a
  package-managed install, and the .NET-enabled build is a separate download from the standard one.
  Detection needs to find both and tell them apart - the standard build cannot run a C# project at all.

## Timeline

- time: "2026-08-08T06:17:54.761Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:17:54.761Z"
  kind: "evidence"
  summary: "Migrated from `projects/godot-integration/godot-integration.md` and the legacy `projects/README.md` ledger. Legacy status: Charter. Ledger summary: The rare engine whose whole project is diffable text, so Changes, blame and history work on it already. Missing: grammars for `.gd`/`.tscn`/`.tres`/`.gdshader`, `project.godot` as a project marker, and a **socket** transport for the LSP pool - GDScript's server is hosted inside the running editor, not spawned over stdio. C# Godot projects need nothing new. Whether the web export runs and is inspectable in Otto's browser pane is unverified and decides how ambitious this gets"
- time: "2026-08-08T06:19:46.699Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
