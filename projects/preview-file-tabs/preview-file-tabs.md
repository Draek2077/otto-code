# Charter: Preview file tabs (VSCode-style transient open)

**Status:** Not started — charter drafted 2026-07-16. Feasibility confirmed against the current tab
model; no blockers, just work.

## What

VSCode's preview-tab behavior: single-clicking a file in the explorer opens it in a **transient
preview tab** (italic title) that the next single-click **reuses** — click through ten files, get one
tab, not ten. Double-clicking the file (or the tab), or **editing the buffer**, pins it into a normal
sticky tab. Requested by the user as an option ("Is there an option to open a file as a preview
without fully opening it as a sticky tab").

## Current model (why it's feasible)

- Explorer single-press always fully opens: `handleOpenFile`
  ([file-explorer-pane.tsx:561](../../packages/app/src/components/file-explorer-pane.tsx)) — no
  single/double-click distinction exists today.
- Targets: `WorkspaceFileTabTarget` (`kind:"file"`,
  [file-open/index.ts:31](../../packages/app/src/workspace/file-open/index.ts)); "one tab per file" is
  enforced by `findExistingTabForTarget` + deterministic tab ids in
  [workspace-layout-actions.ts:1103-1146](../../packages/app/src/stores/workspace-layout-actions.ts).
- The dedup/focus infrastructure is exactly what preview needs — the missing pieces are (a) a
  transient marker on the stored tab, (b) a click discriminator, (c) "replace the pane's current
  preview tab" in the layout actions.

## Design sketch

1. **Tab flag, not target flag:** `preview?: boolean` on the stored `WorkspaceTab` (device-local
   layout state, not protocol — no compat concerns). One preview tab max per pane.
2. **Open path:** explorer single-click → `openWorkspaceTabFocused(..., { preview: true })`. In
   `openTabInLayoutFocused`: target already open (preview or pinned) → focus as today; otherwise if
   the focused pane has a preview tab → **replace its target in place** (same tab id swap semantics as
   `updateExistingTabTarget`); else insert a new tab carrying `preview: true`.
3. **Pinning:** double-click on the file row or the tab title, any buffer edit (dirty state), or
   drag-reordering the tab clears the flag. Explorer's explicit "Edit" affordance opens pinned.
4. **Rendering:** italic tab label (the universal convention) + keep the existing icon.
5. **Setting:** `explorerPreviewTabs` device-local toggle (default on, matching VSCode;
   `workbench.editor.enablePreview` equivalent) in Settings → Appearance/Editor.
6. **Native/compact:** single-tap-preview is a pointer idiom; on native keep today's behavior (flag
   simply never set) — no divergent code paths, the flag just stays false.

## Watch out for

- Double-click detection on RN web Pressables (need a small click-timestamp latch in the row, not
  `onDoubleClick`).
- Mode memory (`file-view-store`) and the unified file tab's editor/split/preview view modes are keyed
  per file — replacing a preview tab's target must not leak the previous file's view mode.
- Tab-close-is-layout-only semantics from subagents-cleanup don't apply here, but `confirmClose`
  (dirty editors) must still fire when a preview tab is about to be replaced with unsaved changes —
  replacing counts as closing.
