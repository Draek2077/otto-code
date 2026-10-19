---
id: "finding-codex-subagent-coordination-rows-and-missing-read-only-callout"
kind: "finding"
title: "Codex subagent messaging renders anonymous rows without a read-only callout"
status: "proposed"
tags: ["codex","subagents","ui","investigation"]
created_at: "2026-10-19T18:58:13.120Z"
updated_at: "2026-10-19T20:15:36.606Z"
---
# Codex subagent messaging renders anonymous rows without a read-only callout

<!-- compiled_truth -->

# Codex subagent presentation repair

The original investigation established that managed_host_capability and operator_qualification are native Codex subagents of RouteOS Staging Deployment. In operator_qualification, 22 interacted activities (21 to parent /root, one to a sibling) and four wait calls were coordination, not 26 new children. Parent Otto chat: fc62a20e-c5fa-4903-8ffe-76c24972ef06; parent Codex session: 01a14ca4-9d1f-7253-aa4f-985ef5a1006d; operator child: 01a15576-52b8-7111-bccf-dbdefc663371.

## Current checkout behavior

The provider-subagent pane now renders the shared Observed subagent · read-only composer replacement and names the owning parent chat. Its Stop action uses provider control with parentAgentId and descriptor id, never stopObservedSubagent. The existing providerSubagentControl capability gate and parent-session confirmation remain in force; terminal children keep the notice without Stop, and pending/disconnected controls are disabled.

Codex spawnAgent calls and started activities retain canonical sub_agent detail and declare child ownership. Message, wait, interruption and resume operations use existing plain_text detail with explicit operation/target labels and inspectable payloads. /root is labeled Parent (/root). Coordination targets cannot become or reparent descendants. The shared normalization handles camelCase thread items and PascalCase/snake_case events. Live interruption still settles an owned child, and historical replay retains separate timestamped coordination rows while hydrating actual nested descendants only. No new wire type is introduced.

## Verification and limits

The changed test files passed: tool-call-mapper.test.ts (50 tests), codex-app-server-agent.test.ts (174 tests), and observed-subagent-callout.browser.test.tsx (5 Chromium tests). These cover child-to-parent and child-to-sibling messages/waits, a child viewed as the session root, nested ownership, replay and settlement, plus callout layout/control/gating/confirmation/failure/retry. App and server typechecks and targeted npm-script lint passed. Durable contracts are documented in docs/chat-lifecycle.md, docs/providers.md and docs/testing.md; component coverage is registered in docs/e2e-coverage-matrix.md.

This is a source repair verified with deterministic provider fixtures and component browser tests, not a post-fix replay of the user's live Codex chat. No existing dev server was available. An isolated agent-lane preview was attempted, then stopped after discussion of that proof boundary; the Otto-browser snapshot timed out. The installed daemon on 6868 was not restarted, and no real chat was prompted or stopped. The repair has not been deployed to the running installed daemon. The original investigation and transcript counts remain in the timeline.

## Timeline

- time: "2026-10-19T18:58:13.120Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["observed-subagents","upstream-subagent-convergence"]
- time: "2026-10-19T18:58:13.120Z"
  kind: "evidence"
  summary: "Read-only investigation on 2026-10-19. Parent Otto agent fc62a20e-c5fa-4903-8ffe-76c24972ef06 has Codex session 01a14ca4-9d1f-7253-aa4f-985ef5a1006d. Codex session metadata identifies children 01a15576-3675-78f2-8423-1964eb4313cd (/root/managed_host_capability) and 01a15576-52b8-7111-bccf-dbdefc663371 (/root/operator_qualification), both with source.subagent.thread_spawn.parent_thread_id matching the parent. Counted event_msg item_completed types and target paths in the operator transcript; source event names use PascalCase and snake_case fields. Source review: packages/app/src/panels/provider-subagent-panel.tsx renders readOnly AgentStreamView and optional child track only; packages/app/src/panels/agent-panel.tsx uses ObservedSubagentCallout for attend observed. packages/server/src/server/agent/providers/codex/tool-call-mapper.ts mapCollabAgentToolCallItem and mapSubAgentActivityItem label coordination as sub_agent. This establishes source-level causes matching the user's screenshots, not a browser replay or a post-fix acceptance proof."
- time: "2026-10-19T19:37:32.041Z"
  kind: "decision"
  summary: "User requested repairing both verified defects and reconciling this finding. Focused mapper/routing/replay and Chromium callout checks now pass; preserve the measured incident and explicitly distinguish fixture proof from the live chat, which was not replayed or redeployed."
  source: "packages/app/src/components/observed-subagent-callout.browser.test.tsx; packages/server/src/server/agent/providers/codex/tool-call-mapper.test.ts; packages/serv"
  affects: ["observed-subagents","upstream-subagent-convergence"]
- time: "2026-10-19T20:15:36.606Z"
  kind: "decision"
  summary: "User requested committing all current changes. Keep the verification and deployment boundary durable without an ephemeral uncommitted-state assertion."
