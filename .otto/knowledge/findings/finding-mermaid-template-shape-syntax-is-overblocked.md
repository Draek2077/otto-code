---
id: "finding-mermaid-template-shape-syntax-is-overblocked"
kind: "finding"
title: "Mermaid template shape syntax is overblocked in Markdown rendering"
status: "proposed"
tags: ["mermaid","markdown","regression","security-policy","file-preview"]
created_at: "2026-09-07T20:48:25.851Z"
updated_at: "2026-09-07T20:58:41.671Z"
---
# Mermaid template shape syntax is overblocked in Markdown rendering

<!-- compiled_truth -->

Mermaid Markdown rendering supports modern flat `@{ … }` template maps for non-network documentation metadata, including shapes, labels, dimensions, constraints, and collapsed views. The earlier blanket `@{` denylist was a security overreach that made safe template diagrams fall back to source code.

The renderer continues to reject resource-bearing template properties (`img`, `icon`, `url`, `href`, `src`, `link`) and ambiguous YAML forms such as aliases, anchors, tags, flow collections, and complex keys. The closed sandbox CSP, strict Mermaid security level, HTML-label limits, and CSS/network denylist remain in force. This preserves the host’s no-fetch boundary without blocking ordinary rich documentation.

The regression affected 0.9.0+ and also predates that range, but is fixed in the current source pending release.

## Timeline

- time: "2026-09-07T20:48:25.851Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-07T20:48:25.851Z"
  kind: "evidence"
  summary: "Verified 2026-09-07: `packages/app/src/components/markdown/fence/mermaid/source-policy.ts` rejects `@\\s*\\{`; its focused test explicitly expects `flowchart TD\\n  A@{ shape: rect }` to be rejected, while ordinary flowcharts are accepted. `MarkdownFenceBlock` dispatches every `mermaid` fence to `MermaidFence`, whose render model uses that policy and falls back to `HighlightedCodeBlock`. The denylist was introduced in commit 7253228dc (2026-08-11) and is already present at tag v0.8.19, so the observed 0.9.0+ range is affected but not the origin. Focused app tests passed: source-policy and Mermaid sandbox runtime, 6 tests in 2 files. User designated this an official regression on 2026-09-07."
- time: "2026-09-07T20:58:41.671Z"
  kind: "decision"
  summary: "Implemented and verified the guarded template policy requested by the user. Status returned to proposed for review."
  source: "Implementation and focused verification, 2026-09-07"
