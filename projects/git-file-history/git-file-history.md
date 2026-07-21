# Git investigation tools for files and selections

**Capability shipped 0.6.6.** The durable architecture moved to
[docs/git-file-history.md](../../docs/git-file-history.md). This file now tracks
only what is left, which is presentation.

## Shipped

- Daemon primitives (`packages/server/src/utils/git-file-history.ts`) and four
  `checkout.git.get_file_*` RPCs behind `features.checkoutGitFileHistory`.
- History for the whole file (`--follow`, so renames don't cut it short) and for
  a line range (`git log -L`), paged.
- The patch a chosen commit applied to the file, raw plus structured.
- Blame, paged so a large file never blocks the daemon.
- The commit that first added the file, followed across renames.
- Client entry point: a selection-aware **Git history** button in the file tab
  toolbar (editor and preview).
- A dedicated **`fileHistory` tab** — commit table, revision diff, and commit
  message as three vertically stacked resizable panes, with blame annotating the
  diff's gutter. Splitter positions persist as one global setting. Whole-file
  and line-scoped are separate tabs.

Two presentation attempts were discarded along the way. The first was a modal
sheet: a bounded card leaves a table floating in whitespace, and master/detail
navigation loses your place every time you step to the next commit. The second
put the list and diff side by side and gave blame its own view — the diff was
starved of the horizontal space code actually needs, and blame-as-a-table sat
apart from the code it describes.

## What's left — presentation

- **Blame in the _editor_ gutter.** Gutter blame now exists in the history
  pane's diff. The editor itself (CM6, plus a native equivalent and the
  read-only viewer) still has none, so "annotate this file while I read it"
  is unanswered.
- **Diff presentation.** The revision diff is unified-only. Side-by-side,
  next/previous difference navigation, and word-level highlighting all want more
  of what the virtualized `diff-pane` renderer already does.
- **Compare arbitrary revisions.** Today you see what one revision changed.
  Selecting two rows and diffing them directly is the other half of the
  JetBrains behavior.
- **Sortable / filterable columns.** Filter by author or by message substring;
  the table is there, the affordances are not.
- **Mobile.** The stacked layout works and drops the splitters, but the column
  set is desktop-shaped — a phone wants fewer, larger rows.

## Related

[docs/text-editor.md](../../docs/text-editor.md),
[docs/git-providers.md](../../docs/git-providers.md) (this feature deliberately
stays out of the forge layer), [projects/diff-base](../diff-base/diff-base.md).
