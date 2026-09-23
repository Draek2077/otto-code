---
id: "reference-evermind-raven"
kind: "reference"
title: "EverMind Raven"
status: "proposed"
tags: ["orchestration","workflows","acp","competitor"]
reference_disposition: "read"
source_url: "https://github.com/EverMind-AI/Raven"
created_at: "2026-09-22T13:25:29.540Z"
updated_at: "2026-09-22T13:25:29.540Z"
---
# EverMind Raven

<!-- compiled_truth -->

# EverMind Raven

Raven ("The Harness of Harnesses") is an Apache-2.0, pre-alpha (v0.1.13) multi-agent host that claims provider-agnostic orchestration, the same claim Otto makes. Read at commit `ec5db9f` (2026-09-22). The public repository has a single squashed commit, so there is no development history.

## What it is made of

- **Runtime:** about 226k lines of Python 3.12 in `raven/`, forked from nanobot v0.1.5 (MIT). Models go through litellm plus native Anthropic, OpenAI Responses, Azure and Codex-OAuth clients. About 46 provider presets, including Ollama, LM Studio and vLLM.
- **Frontends:** `ui-web` is React 19 and Vite with no UI library, built into one inlined HTML page served at `127.0.0.1:18792`. `ui-tui` is vendored whole from Hermes Agent, including its Ink fork. There is no native desktop or mobile app.
- **Protocol:** JSON-RPC 2.0 (loopback TCP for the TUI, WebSocket for the web page), 194 methods. Several Hermes-only methods are stubs.
- **Memory:** EverOS, a pinned local PyPI server (`localhost:18791`, sqlite + lancedb), on by default.
- **Channels:** 12 chat adapters (Telegram, Slack, Discord, WhatsApp via a Node/Baileys bridge, Matrix, Feishu, WeCom, WeChat, QQ, DingTalk, Mochat, Email).
- **Evolver:** an offline CLI research tool. An LLM makes code edits as git commits, scored on AppWorld with statistical gates. Its README says a full-scale run has never been done.

## How it drives other agents

- Every external agent is an **ACP subprocess**. Claude Code runs through the pinned `@agentclientprotocol/claude-agent-acp@0.79.0` adapter, and Codex through `codex-acp@1.1.14` started in `agent-full-access` mode (`raven/agent/subagent/presets.py:122-123,189`). OpenCode, Copilot, Qwen, Kimi, Grok, Hermes and OpenClaw use their native `acp` modes. MiroThinker is the only OpenAI-compatible HTTP agent.
- **Every ACP permission request is auto-approved**, picking `allow_always` first (`raven/acp_client/permissions.py`). The stated reason is that delegated runs are unattended. Delegated agents get no sandbox and no worktree. The README does not disclose this.
- Streaming messages, thoughts, tool calls, plans and cumulative usage come back. Small per-agent dialect modules recover real tool names. Resume uses `session/load` and silently starts fresh on failure.
- `raven acp` is a real ACP server, and A2A serving and sending both exist (sending is text-only).
- The built-in agents (Code, Research, Design, Oncall, PPT) are the same runtime re-launched as ACP servers with different configs.

## The DAG engine (the part most comparable to Otto Workflows)

The host is an LLM tool loop. The model writes a JSON DAG through `run_subagent_dag`. Nodes carry `depends_on`, `inputs` (file or node references), `skills`, `mcps` and an optional stateful `instance` handle. A ready-set scheduler runs independent nodes concurrently under a shared semaphore (8), and at most 30 spawns per hour per session. Failed or skipped nodes cascade `skipped` to their dependents.

Ideas that differ from Otto:

1. **An always-on "did it accomplish the task?" check per node** (`dag_verdict.py`). It is one constrained tool call (`report_verdict`), not a full agent. It is a tool argument rather than prose, so a node that writes "verdict: accomplished" in its own output cannot game it. It returns a failure taxonomy (`missing_user_input`, `missing_credential`, `tool_failure`, `dependency_output_unusable`, `output_limit`, `other`) plus `what_is_missing` and a short evidence quote. It fails open, so a judge outage cannot suspend every graph.
2. **Escalation to the orchestrator instead of failure.** A bad verdict suspends the node as `exception` (its dependents stay pending, not skipped), and the main agent decides `continue`, `abandon` or `replan` through `resolve_dag_node`. A replan brings a validated replacement graph, and the old run records where it went. At most 2 continuations, with a 600s adjudication timeout (`dag_adjudication.py`).
3. **Dependency output is fenced as untrusted data** before it is substituted into a downstream prompt (`dag_render.py`).
4. **Roster-aware validation before dispatch** (`dag_capabilities.py`). It rejects a graph that reuses an `instance` on a stateless agent, or hands a file path to an agent that cannot see that filesystem, before any agent runs.
5. **Stateful instances.** Nodes sharing an `instance` handle reuse one sub-agent session and run one after another (`instances.py`).
6. **A per-run MCP scope.** Saved playbooks can ship MCP server definitions visible only to that run (`dag_mcp_scope.py`).
7. **Mid-run control tools for the orchestrator:** `dag_status`, `cancel_dag`, `resolve_dag_node`. Background run reports are delivered into the orchestrator's chat, with retry.

Weaknesses: adjudication state is memory-only, and a restart leaves nodes `interrupted` with no resume. The judge fails open. There are no human gates, no start confirmation and no workspace-access enforcement.

## Relevance to Otto

The things Otto already has that Raven lacks are the reason Otto keeps its design:

- Agent permissions are shown to the user instead of auto-approved.
- Workspace access is enforced per provider, and a provider that cannot enforce it is refused.
- Human gates and daemon-owned start confirmation.
- Fan-out with keep-best, and an `until` judge loop whose feedback feeds the next iteration.
- JSONata checks, conditional routing, and retry with backoff.
- Frozen run snapshots and durable run records.
- Native desktop and mobile apps, and Preview verification.

The DAG ideas above (1 to 4 especially) are candidate improvements for the Workflows project. They are not decisions yet.

## Privacy note

Onboarding writes `https://skillhub.evermind.ai` into the config, and hub search needs only that endpoint (`raven/config/update.py:30`, `raven/config/raven.py:1206-1219`). So text derived from user prompts goes to EverMind on the turn path by default. The only other outbound calls are a daily update check and an OpenRouter referer header. No analytics SDK was found.

## Timeline

- time: "2026-09-22T13:25:29.540Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["workflows","orchestration-phase-run-engine","orchestration-agent-binding-and-provider-coverage","agent-orchestration","reference-agent-client-protocol-acp","reference-hermes-agent"]
- time: "2026-09-22T13:25:29.540Z"
  kind: "evidence"
  summary: "Shallow clone of github.com/EverMind-AI/Raven at ec5db9fdacc1da6b8fe65e898e1af77b6791b396 (2026-09-22). Checked by hand: raven/acp_client/permissions.py (auto_approver, _KIND_ORDER allow_always first); raven/agent/subagent/presets.py:122-123,189 (adapter pins, agent-full-access); raven/config/update.py:30 and raven/config/raven.py:1206-1219 (Skill Hub default endpoint, optional api_key); module docstrings of dag_verdict.py, dag_adjudication.py, dag_capabilities.py, dag_render.py, dag_mcp_scope.py, instances.py, dag_resume.py. The remaining facts come from two read-only code surveys of the same checkout, with file citations: sizes, channels, evolver, EverOS, UIs, DAG scheduler details. Compared against Otto packages/server/src/server/workflow/workflow-engine.ts (composePhaseTask inlines dependency output without fencing; an unjudged phase passes if it produced any candidate) and graph-engine.ts (retry with backoff, an until loop judged by a full judge agent)."
