---
id: "reference-content-security-policy-level-3"
kind: "reference"
title: "Content Security Policy Level 3"
status: "proposed"
tags: ["artifacts","security","preview"]
reference_disposition: "adopted"
source_url: "https://www.w3.org/TR/CSP3/#directive-frame-src"
created_at: "2026-10-30T03:29:03.721Z"
updated_at: "2026-10-30T03:29:03.721Z"
---
# Content Security Policy Level 3

<!-- compiled_truth -->

W3C CSP Level 3 defines the frame-src directive used by Otto's 0.10 Artifact preview containment. The trusted outer preview document restricts child frames to about:, while the separate opaque inner sandbox runs the self-contained Artifact. Keeping navigation policy on the trusted parent prevents generated content from relaxing it. This supplements, rather than replaces, Otto's document validation, inner CSP and sandbox restrictions. The current Chromium journey verifies allowed interaction and zero requests to a navigation-trap HTTP endpoint. The source does not establish device WebView or packaged Electron Artifact-frame runtime acceptance; those require their own platform evidence.

## Timeline

- time: "2026-10-30T03:29:03.721Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["artifacts"]
- time: "2026-10-30T03:29:03.721Z"
  kind: "evidence"
  summary: "Adopted in packages/app/src/otto/artifacts/frame-document.ts and the Artifact browser acceptance journey. Verified source 0ee4dfc5bd2d4ea5acf449fdb6e76aacff83c9c7; targeted wide/compact acceptance https://github.com/Draek2077/otto-code/actions/runs/40992158932 succeeded. Native and packaged Electron Artifact-frame runtime security acceptance remains separate."
