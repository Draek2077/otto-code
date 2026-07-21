# Git file history, diffs, and blame

Investigate one file — or one selection inside it — through git: which commits
touched it, what each of those commits did to it, who wrote each line, and who
created the file in the first place. JetBrains' "Show History / Annotate", from
the file tab.

Shipped 0.6.6. The point-in-time charter lived in `projects/git-file-history/`.

## This is local git, and it is not a provider feature

Two facts about this subsystem that keep getting re-derived, so they are stated
here first:

- **It is local git, not a hosting provider.** It works in a repo with no
  remote and no GitHub/Bitbucket connection. It must stay out of the forge layer
  (`services/git-hosting/`, [git-providers.md](git-providers.md)) — nothing in
  it may grow a dependency on a forge client, and no forge capability check may
  gate it.
- **There is no per-provider rollout.** Almost everything else in this repo
  ships for one agent provider first and then levels up the rest
  ([CLAUDE.md](../CLAUDE.md)). This one is provider-neutral by construction: it
  inspects the repository, not an agent, so Claude, Codex, Copilot, OpenCode,
  Pi, and any openai-compatible endpoint all get it at the same instant. If you
  are looking for the per-provider adapter, there isn't one and there shouldn't
  be.

## Daemon

`packages/server/src/utils/git-file-history.ts` holds four pure-git primitives.
They spawn `git` through the shared `runGitCommand` with `GIT_OPTIONAL_LOCKS=0`
and never write anything.

| Function              | Git                                                              |
| --------------------- | ---------------------------------------------------------------- |
| `getFileHistory`      | `git log --follow -M --name-status`, or `git log -L a,b:path -s` |
| `getFileCommitDiff`   | `git diff <prev>:./<prevPath> <sha>:./<path>`                    |
| `getFileBlame`        | `git blame --porcelain -L start,+count`                          |
| `getFileOriginCommit` | `git log --follow --diff-filter=A`, oldest record                |

Things that are load-bearing and easy to undo by accident:

- **`--follow` is the whole feature.** Without it the history stops dead at the
  rename — which is exactly the moment someone reaches for file history. Its
  cost is that git must diff each commit to track the path, which is why history
  is paged rather than fetched whole.
- **The per-revision diff compares two blobs, not a commit against a pathspec.**
  This is the one thing in this file most likely to get "simplified" back into a
  bug. `git show <sha> -- <path>` looks obviously right and is wrong: git applies
  the pathspec **before** rename detection, so across a rename it reports the
  file as brand new and every line reads as an addition — the change you opened
  the tool to see is not in the output at all. Comparing
  `<previous revision>:<name then>` against `<this revision>:<name now>` avoids
  that, and it also gives merge commits a real diff, where `git show` on a merge
  prints nothing. `getFileCommitDiff` therefore does a second short `--follow`
  walk to find the file's previous revision, and only falls back to `git show`
  when there isn't one (the commit created the file) or the post-image blob is
  missing (the commit deleted it).
- **The left-hand revision is the file's previous revision, not the commit's
  parent.** The parent is very often a commit that never touched this file, so
  naming it points the reader somewhere nothing happened. The response carries
  `previousSha`/`previousPath` so the client labels what was actually compared.
- **History entries carry the file's name _at that commit_** (`entry.path`,
  plus `previousPath` on the rename commit). A diff request must echo that name
  back, not the file's current name, or the pathspec matches nothing on the far
  side of a rename. Blame's porcelain `filename` field serves the same role for
  blame rows. Merge commits emit no `--name-status` at all, so the walk carries
  the name backwards across renames and stamps it on the records that have none —
  without that, every merge in the list points at the wrong path.
- **Line-range history is `git log -L`, which cannot be combined with
  `--follow`** (git refuses). `-L` does its own rename tracking, and it implies
  a patch, so `-s` suppresses it — we only want the commit list.
- **`--reverse` is applied after `-n`**, so it cannot be used to ask git for the
  oldest commit. `getFileOriginCommit` walks to the last record instead.
- **Blame is always paged.** Blaming a large file whole is seconds of blocked
  daemon, so the client asks for a window (`-L start,+count`, capped at 2000
  lines) and extends it. Paging past EOF is a normal outcome, not an error: git
  exits 128 with "has only N lines" and the primitive reports an empty page with
  `reachedEndOfFile`.
- **Blame results carry a commit dictionary, not per-line author fields.**
  Porcelain emits a commit's metadata once and omits it on later lines from the
  same commit; a thousand-line page usually references a handful of commits, so
  the wire shape mirrors that.
- **Paths and revisions are validated before they reach the command line.**
  `assertRepoRelativeFilePath` rejects absolute paths and `..`; `assertCommitSha`
  accepts object names only, so no revision syntax (`HEAD@{1}`, `..`, `^{/re}`)
  can arrive from a client. Pathspecs always follow `--`.

## RPCs

Four request/response pairs, dispatched from `session.ts` into
`CheckoutSession` (`session/checkout/checkout-session.ts`), all gated by
`server_info.features.checkoutGitFileHistory`
(`COMPAT(checkoutGitFileHistory)`, added v0.6.6):

- `checkout.git.get_file_history.request` / `.response`
- `checkout.git.get_file_commit_diff.request` / `.response`
- `checkout.git.get_file_blame.request` / `.response`
- `checkout.git.get_file_origin.request` / `.response`

They are pure reads, so every response carries a nullable
`CheckoutGitFileError` (`not_git_repo` | `invalid_path` | `git_failed`) rather
than rejecting — the pane shows the message in place. The commit-diff response
also carries an optional `structured` array (the same parsed/highlighted shape
the Changes view uses); a diff that fails to parse still ships as raw text
instead of failing the request.

Client methods live next to the other `checkoutGit*` calls in
`packages/client/src/daemon-client.ts`.

## Client

**It is a tab, not a dialog** (`{ kind: "fileHistory"; path; startLine?; endLine? }`
in the workspace tab union, panel at `packages/app/src/panels/file-history-panel.tsx`,
opener `git/file-history/open-file-history-tab.ts`). This was tried as a modal
sheet first and it was wrong: history is a working surface you keep open beside
the code while you walk commits, not a question you answer and dismiss. A
bounded 600px card also leaves a table stranded in whitespace. The `gitLog` tab
is the model it follows.

Whole-file and line-scoped histories are **separate tabs** — "what happened to
this file" and "who touched these three lines" are different questions, so one
does not evict the other. `identity.ts` keys the tab on path plus scope.

Layout, and the reasons, since these are the things that make a history pane
usable rather than merely present:

- **Three panes stacked vertically** — commits, diff, commit message — with a
  `ResizeHandle` between each (no splitters on compact). Stacked, not side by
  side: a diff is a wide thing, and spending the horizontal axis on four narrow
  list columns makes every line of code wrap or scroll. The list is short and
  wide; the diff is tall and wide.
- **All three are visible at once.** Walking a file's history means stepping
  down commits and watching the diff change; a layout that swaps one for the
  other loses your place on every step.
- **Splitter positions are one global setting**
  (`stores/file-history-layout-store.ts`), not per file or per tab. You arrange
  this pane once to match how you read history and every file after that opens
  the same way; keying it per file would mean re-dragging on every new tab.
- **The commit list is a real table** — Version │ Date │ Author │ Commit message
  under a pinned header, with full-bleed row selection. Column widths live in
  `table-geometry.ts` and are imported by both the header and the rows, because
  the header cannot be a row of the same scroll view (it must not scroll away)
  and two copies of the widths drift on the first edit.
- **The diff header names both sides**: the previous revision + the path the
  file had then → this revision + the path now. That is what stops `--follow`
  from being confusing — without it, a rename reads as a rewrite. A file's first
  revision says "File created" instead of inventing a left-hand side.
- **A difference count**, counting changed _blocks_, not lines — a five-line
  replacement is one edit to a reviewer.
- **The commit message body has its own pane** (`commit-detail.tsx`). The daemon
  has always sent it; the body is where the reasoning lives, and a one-line
  truncated subject is not the commit. It is resizable rather than fixed-height
  because how much room a message deserves depends on the repo.
- **The diff has a real gutter** (`revision-diff-body.tsx`): blame, pre-image
  line number, post-image line number, then the code — rendered from the
  daemon's `structured` payload, which is the only form that carries the hunk
  coordinates a gutter needs. Line metrics come from `theme.lineHeight.diff`,
  shared by the gutter and the code so the columns stay locked and the density
  matches the text editor. Per-line padding is deliberately absent: it drifts
  out of step with the editor and reads as double spacing.
- **Ignore-whitespace and refresh are icon controls with tooltips**, matching
  the Changes toolbar; the whitespace toggle carries a visible on-state, since
  an icon toggle that looks the same in both states is a switch you cannot read.
- **Every scroller uses the auto-hide overlay scrollbar** (`use-web-scrollbar`).

### Blame is a gutter, not a view

Blame was first built as a second table beside the commit list. That was wrong:
blame presented as a list of shas next to a list of authors puts the annotation
in one place and the code it describes in another, so reading it means matching
line numbers by eye. It now annotates the diff gutter directly, which is where
every IDE puts it and why the question it answers ("who wrote _this_") is
answerable at a glance.

Two properties make the annotation true rather than merely present:

- **Blame is resolved at the revision being viewed** (`getFileBlame` takes a
  `sha`), not at HEAD. The diff's line numbers describe the file as it stood at
  that commit; blaming the working tree instead would label them with whoever
  has since touched those line _positions_ — a different file's authorship,
  presented silently as this one's.
- **Runs collapse** (`blame-runs.ts`, unit-tested): consecutive lines from one
  commit print the author once. The repetition does not merely add noise, it
  hides the only thing blame is read for — where authorship changes.

Only the span the diff actually shows is blamed, capped at 2000 lines, and a
blame failure costs the gutter rather than the diff.

Data hooks are in `git/file-history/use-file-history-data.ts` — plain imperative
fetches with local state, no subscription or replica query, because nothing here
updates itself.

### Entry points

Three, all opening the same tab:

| From           | Gesture                        | Gate                                                |
| -------------- | ------------------------------ | --------------------------------------------------- |
| File tab       | Selection-aware toolbar button | `editGate.kind === "free"` (in-project files)       |
| Changes view   | Right-click a file             | host capability only — every row is a tracked path  |
| Files explorer | Right-click a file, or kebab   | host capability **and** the workspace is a git repo |

The Files explorer is the only one that has to ask whether this is a repo at
all: it happily browses folders that git knows nothing about, so it checks
`useCheckoutStatusQuery` (a shared, `staleTime: Infinity` query — the same cache
entry the Changes view already populates, so the check is free). The Changes
view needs no such test; if a file is listed there, it is tracked. In both, the
menu item is simply absent rather than disabled — an item that only ever errors
is noise.

The file-tab button is limited to **in-project files**
(`editGate.kind === "free"`). The queries run `git` in the workspace with a
workspace-relative pathspec, so a linked-project or outside-project file
([gated-multi-root](../projects/gated-multi-root/gated-multi-root.md)) would be
a question aimed at the wrong tree. Lifting that means resolving the file's own
repo root first, not relaxing the gate.

### Why the entry point is a toolbar button, not a right-click menu

The charter asked for an entry point from an editor selection's context menu.
It is a **selection-aware toolbar button** instead: pressing History with lines
selected scopes the history to that range (and opens blame at that line), with
the scope stated above the list and a one-press "Show whole file".

Right-click inside the editor belongs to the platform's own edit menu — copy,
paste, spellcheck. On Electron that menu fires even when the renderer calls
`preventDefault` (see `shouldShowDefaultContextMenu` in
`packages/desktop/src/window/window-manager.ts`), so an app-level menu over the
editor would double up with the native one. Select-then-press is the same
gesture in one fewer step and costs nothing.

## Testing

`packages/server/src/utils/git-file-history.test.ts` drives real `git` in a temp
repo — rename following, paging, line-range scoping, multi-line bodies, blame
attribution and EOF paging, origin across a rename — plus a pure unit test for
the porcelain parser's metadata-carry-forward behavior. The diff cases are the
ones to keep honest: they assert that a rename shows its real edits rather than
`new file mode`, that the left-hand side is the file's previous revision rather
than the commit's parent, and that creation and deletion still produce a patch.

Client-side, `git/file-history/blame-runs.test.ts` covers run collapsing,
`diff-stats.test.ts` covers block counting, `stores/file-history-layout-store.test.ts`
covers splitter-size normalization, and the `fileHistory` cases in
`workspace-tabs/identity.test.ts` cover tab scoping. Run only those files.
