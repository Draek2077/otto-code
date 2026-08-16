---
id: "oversized-module-inventory-the-standing-refactor-backlog"
kind: "finding"
title: "Oversized-module inventory (the standing refactor backlog)"
status: "confirmed"
tags: ["refactoring", "module-map", "oversized-modules", "code-health", "archdocs-retirement"]
created_at: "2026-08-16T13:26:04.244Z"
updated_at: "2026-08-16T13:26:04.244Z"
---

# Oversized-module inventory (the standing refactor backlog)

<!-- compiled_truth -->

Measured 2026-08-16 (line counts re-run against the working tree; the original archdocs module-map figure was 2026-07-19). These modules work, but each concentrates too many systems in one file; they are where "vibe coding" accumulates fastest and they form the standing refactor backlog. Sizes are lines of code at measurement time.

| Module | LOC (2026-08-16) | Systems entangled / decomposition status |
| `server/session.ts` | 12,727 | ~186 methods dispatching nearly every inbound RPC. Decomposition in progress: `server/session/` sub-handlers (files, checkout, git-mutation, provider, voice) already exist; the plan is the session-decomposition project. |
| `agent/providers/claude/agent.ts` | 7,435 | Provider adapter + tool mapping + subagent observation + rewind in one file. |
| `agent/agent-manager.ts` | 7,590 | Lifecycle + broadcast + accounting callbacks + timeline tracking. The chokepoint role is intentional; the size is not. |
| `screens/workspace/workspace-screen.tsx` | 7,643 | The workspace deck: panes, tabs, layout, keyboard, drag-drop. Largest frontend file. |
| `agent/tools/otto-tools.ts` | 6,255 | The whole tool catalog in one module — each tool is a candidate for per-domain files. |
| `agent/providers/codex-app-server-agent.ts` | 6,930 | Same shape problem as the Claude adapter. |
| `agent/providers/opencode-agent.ts` | 4,412 | Same shape problem. |
| `agent/providers/openai-compat-agent.ts` | 4,411 | Same shape problem. |
| `agent/providers/acp-agent.ts` | 3,487 | Same shape problem. |
| `git/diff-pane.tsx` | 3,937 | Diff rendering — performance-critical, monolithic. |
| `components/message.tsx` | 3,902 | The chat bubble renderer — performance-critical, monolithic. |

Note on paths: since the archdocs page was written, the provider files other than Claude's have moved from per-provider subfolders (`providers/<x>/agent.ts`) to flat `providers/<x>-agent.ts`; the inventory above uses the current paths.

The rule going forward: new capability code lands in the decomposed shape (per-domain session handlers, per-domain tool files), and every substantial touch of a listed module should move at least one responsibility out.

## Timeline

- time: "2026-08-16T13:26:04.244Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["the-monorepo-separates-daemon-protocol-client-app-desktop-cli-and-supporting"]
- time: "2026-08-16T13:26:04.244Z"
  kind: "evidence"
  summary: "Re-measured 2026-08-16 by reading each file's line count from the working tree (node:fs). Original point-in-time figures from the retired archdocs page 02-module-map (authored 2026-07-19). This is a finding, not architecture: it is a point-in-time measurement of where the refactor debt concentrates, and the numbers will drift."
