# File Editor and code intelligence

Otto extends Paseo 0.12's file pane. Paseo's `FileEditorModel` remains the sole
owner of source text, saving, BOM and line endings, external-file observations,
and conflict resolution. Otto supplies optional renderer extensions, tools,
language servers, document views, and real terminal editors through small
`OTTO(editor)` seams. Feature code lives in `packages/app/src/otto/editor`,
`packages/server/src/server/otto/editor`, and the `otto-editor` built-in plugin.
The existing authenticated plugin channel carries editor requests. Relay and
Hub identities are unchanged.

## Paseo and Otto ownership

| Capability                                                                                | Owner                                                       |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| File tabs, source model, save/watch/conflict, syntax themes, ordinary Vim mode            | Paseo                                                       |
| File Explorer, workspace file finder, HTML sandbox, image zoom, Markdown/Mermaid renderer | Paseo                                                       |
| Semantic completions, hover, definition, references, diagnostics and reviewed rename      | Otto host service and renderer extensions                   |
| Outline and workspace symbol search when semantic support is absent                       | Otto's bounded Lezer name index                             |
| Project content search and reviewed replacement                                           | Otto, sharing Paseo's workspace walker and atomic writer    |
| Source/Split/Preview, Markdown editing tools, document notes and exports                  | Otto, using the existing source model and rendering engines |
| Actual Vim, Neovim or a custom command in a file-owned PTY                                | Otto lifecycle adapter over Paseo terminals                 |
| Evaluated read-only .NET solution membership                                              | Otto's portable SDK sidecar                                 |

Editor actions are in the source toolbar's **Code intelligence** menu.
**Inspect symbol** exposes hover information without requiring a mouse, including
on compact and native clients.
Document exports are also available from **Document tools** in Markdown Preview. Tools
stay within the workspace pane. Results occupy the right inspector on wide
layouts and a stacked panel on compact layouts. Rename and replacement share a
file-list/diff review sheet, with individual operation outcomes and safe undo.

## Language servers and host settings

**Settings → Host → Code** controls the selected host, including remote hosts.
Code intelligence is enabled by default. Processes start only when an editor
requests the corresponding language. Opening Settings discovers commands but
does not launch or install a language server.

| Server                | Resolution and prerequisites                                                         |
| --------------------- | ------------------------------------------------------------------------------------ |
| TypeScript/JavaScript | Project package first, then Otto's bundled TypeScript language server and TypeScript |
| Python                | Project package first, then bundled Pyright                                          |
| C#                    | Host-installed `csharp-ls`; current releases require the .NET 10 SDK                 |
| Oxlint                | The project's own package and configuration; never a global substitute               |

Missing tools offer **Copy install command** and an explicitly confirmed **Run
in terminal** on the selected host. C# additionally shows its SDK prerequisite
and vendor installation documentation. Linux SDK installation follows the
distribution's official instructions instead of assuming an apt repository.
Neither discovery nor a model request installs software.
TypeScript automatic type acquisition is disabled; the server uses the project's
existing declarations instead of installing packages into a global cache.

One host-wide pool enforces language enablement, process limits, workspace
reuse and idle reaping. In-flight requests hold their process reservation, so
an idle sweep cannot kill busy work. Admission rechecks released demand before
starting a child. Shutdown and workspace archival release owned processes.
Diagnostics retain document and version identity; a response for another draft
cannot decorate the current source. Positions use zero-based UTF-16 on the LSP
boundary and one-based lines/columns in navigation and UI.

Host preferences are revisioned in `editor/settings.json` under that daemon's
home. Saving preserves unknown fields. On the first read, an absent owned file
projects the previous Otto `daemon.lsp` and solution settings without rewriting
the legacy file. Device settings preserve the previous editor, custom command,
Markdown exception, Vim leader mappings, and ruler keys.
Paseo's existing Vim-keybindings switch retains its immediate-save behavior.
The separate File editor form saves only Otto-owned options and cannot overwrite
that switch with a stale form value.

The name index is a bounded source-name fallback, not a semantic language
server. A valid empty semantic result stays empty. The index shares Paseo's
gitignore-aware, symlink-aware workspace walker; it does not launch ctags.

## Workspace edits and dirty files

A rename or replacement first produces a host-owned, expiring review plan.
Applying accepts that plan's ID, not a new set of client-authored edits. Every
file is rechecked before writing. Changed files and dirty peer drafts are left
unchanged, with an individual conflict result. Partial success is explicit.
Undo touches only files that still contain the exact after-image of that run.
If the writer reports a failure after committing, readback distinguishes a
present after-image and retains its undo entry while preserving the warning.

Foreground document leases expire and release language-server demand. Mounted
tabs separately publish a dirty-status bit on transitions, including while
hidden. This guard stores no draft text and holds no LSP process. It is removed
on tab disposal, disconnect, workspace release or shutdown. A client's reviewed
writes wait for its own outstanding guard acknowledgments; failed protection
blocks the write until reconnection rather than silently proceeding.

Project content search supports literal/regex, case and whole-word matching,
and include/exclude globs. It scans at most 5,000 files/20,000 entries and 32 MB
of eligible source, with a 1 MB per-file limit, 200 matches per file and 2,000
displayed matches. Limited results are labeled. Search snapshots are bounded
and expire. Regex execution occurs in a serial worker with a per-file time
limit, so a pathological pattern cannot stall the daemon event loop. Reviewed
replacement uses the same dirty-file checks, writer and undo as rename.

## Editor views and Markdown

Source/Split/Preview uses the previous `file-view-prefs` persistence identity.
The split ratio and horizontal/vertical arrangement are user preferences. A
measured proportional scroll link synchronizes source and Markdown preview only
while Split is active, suppressing programmatic echoes. A
source editor remains mounted after first use, retaining undo, selection and
scroll through view changes. Preview-only documents do not eagerly mount a
hidden source editor. Hidden source renderers stop semantic demand and local
animation/input work.

The source footer sheds metadata by measured width: cursor and diagnostic
facts remain usable in compact layouts. Unknown diagnostics are not displayed
as zero problems. The overview lane marks diagnostics, selections, search hits
and the viewport. The ruler and Vim leader mappings remain device preferences.
Editor and Markdown shortcuts use the existing shortcut Settings registry,
including reassignment, chords and unassignment.
Web Find commands delegate to Paseo's floating query owner, including refocusing
an already open query. The default keeps Mod+G for Find next and Alt+G for Go to
line. Serialized shortcuts use the app's platform policy, so Control+F remains
a text-editing key on macOS unless the user explicitly reassigns it.

Markdown source uses marker-based live formatting, link/heading completion,
HTML-to-Markdown paste, table operations and a horizontally scrolling formatting
toolbar. Pasted/dropped images are written to the source document's host-owned
asset directory. They use exclusive names and operation IDs, never overwrite an
existing asset, and insert into a mapped selection only if its owning editor
activation and range remain valid. Images are limited to 2 MB each and eight
per gesture. A late write is reported without inserting into a new activation.

Mermaid documents and AsciiDoc use the existing diagram and Markdown engines.
Read-only source keeps Paseo's web CodeMirror Find and adds bounded, explicit
Find/next/previous to the native token viewer. Image previews retain Paseo's
pinch/wheel/pan stack, with header-derived dimensions, natural-size fit and an
image-only transparency checker. Binary/error views can reveal actual local
files through the existing desktop file-manager bridge; remote paths never go
to the client filesystem.
AsciiDoc conversion does not execute includes or fetch external files. Converted
documents do not receive invented source locators. Original Markdown headings
can contribute workspace review notes; removing the Composer pill removes the
corresponding saved note. Source/file attachments and notes become plain
provider-neutral context. Ordinary file/selection attachments are path and range
references; they do not duplicate source in the model request. Explicit review
notes carry bounded captured excerpts labeled as possibly unsaved source.

Document export uses the live source, not a forced save. HTML generation keeps
task lists, alerts, footnotes and MathML math. PDF is an explicitly invoked
desktop print capability using that same static HTML. Printing runs in an
isolated, script-disabled window without HTTP, HTTPS or local-file access.
The bytes return to the owning daemon. Exports create new sibling files there;
an existing name receives a numeric suffix instead of being overwritten.
Export size is bounded, repeated operation IDs are idempotent, and the source
file is never rewritten by an export.

## Actual terminal editors

**Settings → Editor → File editor** selects Otto, Vim, Neovim or a custom
command. The Markdown exception can keep Markdown in Otto. This differs from
Paseo's built-in Vim keybindings: terminal mode runs the user's real editor,
normal configuration and plugins on the owning host.

The daemon parses a quoted command into arguments without shell expansion.
Vim/Neovim receive an optional line target and a literal file argument after
`--`. Custom commands receive the file as one final argument. There is no
Neovim embedding or substitute editor engine.

File PTYs have server-issued `otto-editor:` identities and are not auto-opened
as standalone Terminal tabs. Reopening adopts an existing session instead of
launching another. A lost launch response is resolved before an explicit retry.
Settings changes do not retarget an active buffer. Leaving or stopping requires
confirmation because its unsaved buffer belongs to the external editor. Bulk
close consults each owner before removing tabs. Returning to Otto refreshes
through the existing conflict-aware file model.

## .NET Solution Files

Solution Files is opt-in in the host's Code settings. It is the shipped
read-only solution model: solution folders, projects, evaluated source items,
project references and package information. No planned solution/project mutation
engine is exposed.

The portable .NET 8 payload is packaged with the daemon and desktop, with locked
NuGet dependencies. It uses the actual host's SDK/MSBuild and executes only
after the user enables and opens the view. No installed SDK is changed. The
host bounds idle probes and shares a .NET child-process ceiling with C# language
servers. The desktop carries the payload outside ASAR; Docker and Nix build the
same payload through their own dependency owners.

## Boundaries and verification

Explicit files outside a registered project keep their own parent directory as
a single-file scope. Workspace-only search, context and symbol actions are
withheld. There is no whole-drive fallback. Host filesystem permissions still
apply, including Windows rename/locking behavior and external-editor races.

Pure fixtures cover transforms, shortcuts, positions and lifecycle. Real file
fixtures cover search, reviewed writes, conflicts, undo and asset creation.
Language-server fixtures exercise bundled TypeScript and Pyright; dedicated CI
installs C# and verifies it against a disposable project. The offline native
editor fixture runs the shipped WebView document in Chromium. App acceptance
exercises wide/compact UI and real file-owned Vim/Neovim/custom PTYs. Browser
bridge proof does not claim physical Android/iOS keyboard or IME acceptance.

**Refactor with AI** opens a scoped, prefilled chat draft through the existing
Composer store. The user reviews the provider/model and sends it normally. The
editor does not launch an agent or generate/apply a patch itself. Direct editor
generation and the separate CLI-isolation investigation remain parked.
