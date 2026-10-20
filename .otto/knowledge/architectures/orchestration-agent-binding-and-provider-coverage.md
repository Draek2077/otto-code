---
id: "orchestration-agent-binding-and-provider-coverage"
kind: "architecture"
title: "Orchestration agent binding and provider coverage"
status: "confirmed"
tags:
  [
    "orchestration",
    "agent-binding",
    "seat-resolution",
    "authority",
    "provider-coverage",
    "archdocs-retirement",
  ]
created_at: "2026-08-16T13:24:06.550Z"
updated_at: "2026-08-16T13:24:06.550Z"
---

# Orchestration agent binding and provider coverage

<!-- compiled_truth -->

This is the layer no orchestration framework has and where Otto's advantage lives: a graph node is not a function or a model call but a named agent with a personality, a model, an authority and a working directory, running as a supervised OS process. This page is the seam between a node's declaration (the data model) and a live process; how the engine schedules it is the graph-engine execution model.

Seat resolution: a node names a role, not a person. At spawn, `resolveTeamRoleMember` finds the active team member carrying that role; a node with no role uses its explicit `model`. A role nothing fills fails loudly and names the gap — never a silent fallback to a default model the user did not choose. Roles are what keep graphs portable: the same graph runs on an all-local-model team and an all-Claude team, because the graph names the job, not the brain. Resolution is snapshotted at run start (fixed 2026-07-25): the graph path freezes the team view, the personality roster and the prompt-template store once, at start — every node seat, every composed team prompt and every template render resolves against that frozen view, so a mid-run team or template edit cannot shear a running orchestration. The phase-run path gets the same guarantee from its per-run role cache. This is also what makes a run reproducible, which the evaluation harness depends on.

Authority: three narrowings, one direction. The rule is that authority is applied at spawn, never requested in prose — an agent told in its prompt not to use a tool it has been given will eventually use it. Every mechanism below withholds; none asks. (1) Tool policy — the `autonomous` flag yields a `deterministic` or `autonomous` label; deterministic strips orchestration, preview and browser tools, autonomous grants the Otto toolset minus `start_workflow`; orchestrations never nest. (2) Otto tool groups — `GraphNode.tools` is an allowlist over the eight groups, intersected with the policy and the daemon-wide allowlist, so a node narrows its own authority and never widens it; an empty array is meaningful ("no Otto tools at all"); it is also a cost lever (the catalog is paid in input tokens per request). (3) Workspace access — `GraphNode.access` is `none`/`read`/`write` (absent ⇒ `write`), rides on `AgentSessionConfig.workspaceAccess`, and each provider adapter withholds its own tools; it is a boundary, not an instruction. Plus query tools — author-defined read-only lookups scoped to one node's session, read-only by construction (argv with `shell: false`, GET-only with no author headers, path-checked reads).

Two consequences worth stating plainly: narrowing-only has a real casualty — the browser-verified verifier. A deterministic node can never gain preview/browser (the intersection can only shrink the policy baseline), and the only way to grant them is full `autonomous`, which grants far more; so "a verify node with exactly preview + terminals" is a hole, not a corner case. And provider-native sub-agents are a separate axis, still ungated per node: suppressing them (Claude's `disallowedTools`) is what would make a deterministic node fully deterministic; today only Otto tools are gated.

How declarations travel: everything a node declares reaches its agent as labels (`otto.orchestration-*`), read back by the per-agent Otto tool catalog, which mints `submit_output`, registers query tools and applies the group allowlist. No provider adapter parses a graph, and no engine code branches on a provider — this indirection is the entire provider-neutrality story.

Lifecycle: Spawn — `createAgentCommand` with the resolved seat, the labels above, parented to the orchestrator agent, bound to the run's workspace. Settle — `waitForAgentFullySettled`, whole subtree: an autonomous node that spawned helpers is re-invoked when they finish and writes its real answer afterwards; settling on first-idle would capture a premature one. Extract — the `submit_output` store is taken, not read, one submission belongs to one settle, so a later iteration can never inherit an earlier answer; no submission → balanced-JSON recovery from the final message → failure naming the contract. Failure — agent status `error`, or the settle call throwing → a `failed` node result, into the engine's retry policy. Because every node is an ordinary agent, parentage, the usage ledger, activity stats, the sub-agents track and the Visualizer all work with no orchestration-specific plumbing.

Provider coverage: the one axis that differs per provider is workspace-access enforcement, and a provider that cannot enforce it refuses the node at spawn — running a `read` node with full access is precisely the failure the feature exists to prevent. openai-compat (incl. local models): total (the daemon owns the tool loop, forbidden specs are withheld, the model is never told they exist). Claude: `applyWorkspaceAccess` adds the level's denied tools to `disallowedTools` and strips them from `allowedTools`, applied after the dontAsk allowlist so a deny always wins. Codex: mapped onto its native sandbox tiers as a ceiling — the seat's tier can be narrowed, never widened. Everything else: not supported, the spawn is refused naming the node, level and provider; never set `supportsWorkspaceAccess` without the enforcement behind it. Local AI is a design constraint, not a nice-to-have: a graph is worth more to a small local model than to a frontier one because it supplies exactly what a smaller model is worst at holding — decomposition, sequencing and a definition of done. Any node feature that silently requires a frontier model must degrade, or be declared as needing a capable seat at spawn rather than failing mid-run.

Invariants: a node names a role and a role nothing fills fails loudly naming the gap; authority is enforced by withholding at spawn, never by prompt, all three narrowings only narrow; `start_workflow` is withheld from every orchestration participant (orchestrations never nest); declarations travel as labels, no provider parses a graph and no engine code branches on a provider; whole-subtree settle, never first-idle; a submission is taken once, an iteration can never inherit an earlier one; a provider that cannot enforce `access` refuses the node, never silently runs it wide; the cast and the templates are frozen at run start; a canceled run cancels its in-flight children (the cascade, on both engines). Designed, not built: per-node worktree isolation; native sub-agent suppression per node.

The shipped per-provider `access` table and the node-level declaration gotchas (tool groups, query tools, workspace access, retry/time limit, output fields, submit_output) live in `docs/orchestration-node-capabilities.md` — that page is authoritative for node-level behaviour; this record owns the binding seam and the provider-coverage rule.

## Timeline

- time: "2026-08-16T13:24:06.550Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["orchestration-domain-model-and-engine-invariants","orchestration-node-capabilities","orchestration-graph-engine-execution-model"]
- time: "2026-08-16T13:24:06.550Z"
  kind: "evidence"
  summary: "Ported from the retired archdocs page 16-orchestration-agents (reconciled to code 2026-07-25). Where this and the code disagree, code wins."
