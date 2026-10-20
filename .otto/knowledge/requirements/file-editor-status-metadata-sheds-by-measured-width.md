---
id: "file-editor-status-metadata-sheds-by-measured-width"
kind: "requirement"
title: "File Editor status metadata sheds by measured width"
status: "confirmed"
tags: ["file-editor","responsive-design","mobile","status-bar"]
created_at: "2026-09-04T18:15:46.674Z"
updated_at: "2026-09-04T18:15:46.674Z"
---
# File Editor status metadata sheds by measured width

<!-- compiled_truth -->

The File Editor status bar responds to its measured container width, not a device label. On narrow surfaces it retains the language, cursor and active Vim state, plus error and warning diagnostic totals; file size, image dimensions, EOL, UTF-8, selection detail, informational diagnostics, and hints return only as width permits. This prevents status details from competing with or clipping the editor on phones and narrow desktop splits.

## Timeline

- time: "2026-09-04T18:15:46.674Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-04T18:15:46.674Z"
  kind: "evidence"
  summary: "Implemented in `packages/app/src/editor/editor-status-bar.tsx` via the pure `resolveEditorStatusBarLayout` policy in `editor-status-bar-layout.ts`. Verified 2026-09-04 with `npx vitest run packages/app/src/editor/editor-status-bar-layout.test.ts --bail=1`, targeted lint, and `npm run typecheck --workspace @otto-code/app`. User direction: \"If there is not enough room to show the details then we have to drop some categories responsively as we have less room on different devices.\""
