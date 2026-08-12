---
id: "codex-visualize-widget-compatibility"
kind: "architecture"
title: "Codex visualize markers use the Widget renderer"
status: "proposed"
tags: ["codex", "widgets", "provider-neutrality", "compatibility"]
created_at: "2026-08-12T01:50:33.746Z"
updated_at: "2026-08-12T01:50:33.746Z"
---

# Codex visualize markers use the Widget renderer

<!-- compiled_truth -->

When Codex emits its host-specific visualize content marker pointing to a local HTML fragment, Otto should translate the bounded `.html` fragment into a synthetic `show_widget` timeline call. The existing Widget sandbox and renderer remain the sole inline-visual rendering path; malformed, missing, or oversized references stay visible as text.

## Timeline

- time: "2026-08-12T01:50:33.746Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-12T01:50:33.746Z"
  kind: "evidence"
  summary: "User explicitly requested a native compatibility experiment on 2026-08-11 after observing a literal `visualize{…}` marker in a Codex transcript. Implemented and covered by packages/server/src/server/agent/providers/codex-app-server-agent.test.ts."
