---
id: "file-toolbar-sheds-least-important-buttons-in-a-fixed-order"
kind: "requirement"
title: "File toolbar sheds least important buttons in a fixed order"
status: "proposed"
tags: ["file-editor","toolbar","responsive","ui"]
created_at: "2026-08-21T04:46:41.891Z"
updated_at: "2026-08-21T04:46:41.891Z"
---
# File toolbar sheds least important buttons in a fixed order

<!-- compiled_truth -->

When a File Editor or File Preview pane is too narrow to hold its whole toolbar, the bar hides buttons instead of overflowing, in this order as room runs out: 1. Refine with AI, 2. Export as HTML, 3. Export as PDF, 4. Find in Files, 5. View Changes, 6. Outline, 7. Word wrap. Everything else stays: save, revert, file history, Add to chat, the external-editor button, Find, the host's leading slot, and the view mode bar. Hidden actions are dropped outright, not folded into an overflow menu; widening the pane restores them in reverse order.

## Timeline

- time: "2026-08-21T04:46:41.891Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T04:46:41.891Z"
  kind: "evidence"
  summary: "Requested by the user on 2026-08-20 for the file editor toolbar. Implemented in packages/app/src/components/file-toolbar-collapse.ts (order, width resolver, measuring hook) and wired into both toolbars in packages/app/src/components/file-tab-pane.tsx; documented under \"The toolbar in a narrow pane\" in docs/text-editor.md. The reason overflow is unacceptable: the view mode bar sits at the right edge and was the first control pushed off screen, which is the control that gets the user back to a wider view. Verified live against the dev web app: at a 520px pane every button showed; at 320px Refine, Export as HTML and Find in Files were gone; at 220px Outline went too; widening restored all of them."
