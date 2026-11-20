# Diff presentation

Settings → Editor → Diffs stores the default presentation on this device. Existing Otto 0.9
choices carry over with the Changes preferences. Reviewers can select
**Line** or **Structural** in the toolbar for the current Changes, commit review, or File History.
Refine and edit cards offer the same presentation control when they have a diff. Expand
**Diff preview** in Editor settings to compare both renderers on the same sample. Preview controls
leave the saved default intact.

Line keeps the checkout's exact change rows and the configured unified or split layout. Structural
aligns related source on two sides. It uses bounded projections of complete syntax trees and
retains the patch's source coordinates, review targets, syntax colors, and full text. Where an exact
source pair or supported parser is unavailable, the reviewer sees the Line rows and the reason
Structural is unavailable. Binary and oversized files keep their existing file status.

The active Structural review requests source evidence. Ordinary checkout and commit queries retain
their existing payloads. The daemon reuses the texts it reads for syntax highlighting and checks
them against patch coordinates. Source evidence is optional across versions, limited to 16,000
characters per side, and has a separate 128,000-byte budget across a working diff. This evidence
cannot make an otherwise displayable Line diff exceed its frame limit.

The parser assigns a syntax tier to languages with explicit structural comparison and a context tier
to languages that need conservative pairing, including indentation-sensitive and markup formats.
Structural labels formatting-only changes when complete syntax fingerprints match. Those lines
remain visible. Per file, alignment admits at most 2,000 patch lines, 8,192 candidate pairs, and
2,000,000 candidate text characters before falling back. Each source index is bounded by 16,384
syntax nodes and 8,192 significant leaves. Up to four snapshot indexes are shared by eligibility
checks and rendering. The renderer uses the same viewport and review model as Line in checkout
and commit review.

**File History** is available from the editor's Document tools. It pages local Git revisions,
follows a file through renames, compares consecutive file revisions and offers paged blame and
file-origin information. **File History for selected lines** uses Git's line-range history.
These reads use the workspace checkout and work without a forge account.

The structural fixtures retain the Difftastic source samples carried by Otto 0.9.35. They check
alignment, both source sequences, fallback, significant literal edits, and deterministic work
bounds.
