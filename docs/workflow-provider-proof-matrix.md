# Workflow provider and runtime proof matrix

This matrix is the release evidence record for the provider boundary of
[Workflows](workflows.md). It deliberately separates a provider whose adapter can
carry the Workflow contract from a provider that has completed a controlled
Workflow run. Capability inspection and deterministic tests prove mechanics.
They do not turn an unrun provider/model pair into a release claim.

## Evaluation rule

A Workflow selects an **agent profile**, not a raw provider shortcut. At launch the
profile must resolve on the selected host and workspace: its provider must be
available, its model and mode must exist, and the active team must contain each
role required by the declared work. A missing or unavailable profile fails by name;
Otto never substitutes another provider. See [Agent profiles](agent-profiles.md).

Every provider family below shares the daemon-owned Workflow engine. The engine
owns role resolution, managed worker creation, gates, cancellation, persistence,
restart recovery, history, and Visualizer projection. A provider adapter supplies
the agent session and, for Graph nodes, proves the requested workspace-access
ceiling before the worker is created. See
[Graph node capabilities](workflow-node-capabilities.md).

| Provider/runtime family                                                                       | Workflow declaration and workers                                                                                                                                 | Graph workspace access                                                                                              | Verified evidence                                                                                                                                                                                                                | Release verdict                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic mock provider                                                                   | Scripts AI declaration, managed workers, gates, provider error, cancellation, and restart recovery through the ordinary daemon path.                             | T1 mechanics; it is not a customer-selectable runtime claim.                                                        | Focused server and Chromium T1 checks listed below.                                                                                                                                                                              | **Proven mechanics baseline.** It proves product plumbing for every adapter, not real inference.                                       |
| Claude                                                                                        | MCP-capable conductor and workers. The profile and team resolve before spawn.                                                                                    | Write, read, and none are enforced by Claude's denied-tool configuration.                                           | Controlled isolated Sonnet 5 low-effort run recorded 2026-08-29: one conductor declared a `fanOut: 2` research phase and both managed workers completed.                                                                         | **Representative live declaration/fan-out proven.** A new paid run needs owner authorization.                                          |
| Codex                                                                                         | MCP-capable conductor and workers. The profile and team resolve before spawn.                                                                                    | Write and read are enforced by native sandbox narrowing. `none` is refused because Codex has no no-filesystem tier. | Controlled isolated Codex Luna low-effort attended-gate proof recorded in the Workflow evidence.                                                                                                                                 | **Representative live attended-gate proven.** `none` is an explicit product limit, not a weaker fallback.                              |
| OpenAI-compatible, including local LM Studio, Ollama, vLLM, and llama.cpp Responses endpoints | The daemon owns the tool loop, so the same Otto tool catalog and worker contract are supplied to hosted and local models.                                        | Write, read, and none are fully enforced by withholding unavailable tool specifications.                            | Adapter authority tests pass. The loopback Workflow fixture is present, but its isolated daemon currently blocks during workflow-agent execution before it can emit durable proof. A real local-AI Workflow runtime has not run. | **Mechanically supported; declaration proof blocked and real local runtime unproven.** Do not advertise local Workflow runtime parity. |
| OpenCode and OMP                                                                              | MCP-capable adapter path; normal write-default nodes can use the shared Workflow engine.                                                                         | No verified read or none enforcement capability, so nodes requesting either level are refused before spawn.         | Adapter capability inspection only; no controlled Workflow run.                                                                                                                                                                  | **Capability-limited and unproven.** No provider-native workflow substitute is used.                                                   |
| Pi                                                                                            | MCP support is session-configuration dependent. A configured session must expose Otto MCP before its conductor can declare a Workflow.                           | No verified read or none enforcement capability, so those nodes are refused before spawn.                           | Adapter capability inspection only; no controlled Workflow run.                                                                                                                                                                  | **Conditional and unproven.** The UI must surface the unavailable profile/capability reason.                                           |
| ACP family, including Copilot and configured generic ACP agents                               | ACP adapters advertise MCP-server support, so an available profile can use the daemon Workflow path. Individual ACP runtimes still own their real compatibility. | The common ACP capability set does not prove read or none enforcement; those Graph nodes are refused before spawn.  | Adapter contract coverage only; no controlled Workflow run for a specific ACP runtime.                                                                                                                                           | **Write-default mechanics only, runtime proof pending.** Do not claim broad ACP Workflow support.                                      |

## Reproducible evidence commands

Run these from the repository root unless the command changes directory itself.
They do not call a paid provider.

```powershell
# Profile storage, role validation, and profile availability mechanics.
Push-Location packages/server
npx vitest run src/server/agent/agent-profiles.test.ts --bail=1

# Real daemon plumbing with deterministic fake-backed children:
# worker creation, a human gate, missing-role refusal, and cancellation cascade.
npx vitest run src/server/workflow/workflow.integration.test.ts `
  -t "pauses a Graph at a human gate|hard-fails and names the gap" --bail=1
npx vitest run src/server/workflow/workflow.integration.test.ts `
  -t "cancels a held fake worker" --bail=1

# AI planning cancellation, no-plan error, and durable restart failure.
npx vitest run src/server/workflow/workflow-service.test.ts `
  -t "cancels an AI Workflow while its orchestrator is planning|fails a durable AI Workflow when planning ends without a declared plan" --bail=1
npx vitest run src/server/workflow/workflow-service.test.ts `
  -t "init marks a persisted in-flight run as failed" --bail=1

# Provider authority boundaries. These cover Claude, Codex, and the native
# OpenAI-compatible adapter without using a model endpoint.
npx vitest run src/server/agent/providers/claude/agent.workspace-access.test.ts `
  src/server/agent/providers/codex-app-server-agent.test.ts `
  src/server/agent/providers/openai-compat-agent.test.ts --bail=1
Pop-Location

# T1 history and run-scoped Visualizer representation, isolated from shared daemons.
npm run test:e2e --workspace=@otto-code/app -- e2e/browser/runs-screen.spec.ts
npm run test:e2e --workspace=@otto-code/app -- e2e/browser/graph-workflow-authoring.spec.ts
```

The focused T1 proof asserts the durable Workflow card, AI failure and restart
representation, Graph gates and cancellation, and the run-scoped Visualizer. A
canceled active Graph worker currently projects as `failed` while its downstream
unstarted node projects as `skipped` with reason `canceled`. That is a known
presentation finding, not a hidden green condition.

## Controlled live runs

These commands are intentionally not part of ordinary validation. They create an
isolated temporary daemon and copy the selected home configuration, but they may
consume the selected provider's quota. Run each only with fresh owner authorization.

```powershell
# Claude representative declaration and managed fan-out.
npm run live:workflow -- --bootstrap-sonnet --timeout 300 --prompt `
  "Use start_workflow to declare one research phase with fanOut 2. Each worker must return WORKFLOW FAN-OUT CONFIRMED."

# Codex representative attended gate. The one-member fixture intentionally has
# no worker phase; it proves declaration, pause, approval, and terminal reuse of
# the same durable Workflow record.
npm run live:workflow -- --bootstrap-codex-luna --approve-gate --timeout 300 --prompt `
  "Use start_workflow to declare an attended gate named Release approval and no worker phases. Wait for approval, then report the durable run id."
```

The no-cost loopback fixture is deterministic adapter infrastructure, not
local-model evidence. It starts a temporary in-process daemon and private
OpenAI-compatible HTTP endpoint and is intended to assert one persisted AI
Workflow plus a deterministic recovery result. It never reads the source Otto
home, contacts a provider, or uses ports 6868/6788:

```powershell
npm run live:workflow -- --bootstrap-openai-compatible-fixture --timeout 60
```

On 2026-08-29 the command reached the isolated daemon and seeded local team,
but blocked during workflow-agent execution before the durable assertion. This
is the current external blocker for the declaration proof. Do not record a
passing result until that command exits zero with its assertion line.

The existing local-AI proof remains deliberately narrower:

```powershell
npm run test:e2e:local-ai --workspace=@otto-code/app -- e2e/browser/openai-compat-loop.local.spec.ts
```

That command proves a real local tool loop, not a Workflow declaration. A
controlled real-local Workflow declaration still requires an owner-supplied,
loaded endpoint and model, plus a passing targeted run that proves the same
durable effects. It is the release blocker for changing this row to local
runtime parity.

## Release and user-facing wording

Use this wording until the pending rows have controlled evidence:

> Workflows use the selected available agent profiles and a daemon-owned execution
> engine. Claude and Codex have controlled representative live Workflow proof.
> OpenAI-compatible local models use the same daemon-owned tool and workspace
> authority path, but a controlled local Workflow run is still pending. Providers
> that cannot enforce a requested Graph workspace-access level refuse that node
> with remediation; Otto does not silently run it with broader access.

Do not say that every provider has identical Workflow runtime behavior, or that
the local/OpenAI-compatible path has completed end-to-end Workflow proof.

## Development-only Graph entry gate

The development-only app entry gate remains in place. A later gate review needs
all of the following concrete evidence, not a code-completeness judgment:

1. Focused browser T1 proof of saved-Graph validation, author → launch,
   agent-node completion, attended gate approval and rejection, user
   cancellation, restart recovery, and the retained run Visualizer.
2. A controlled local/OpenAI-compatible runtime declaration with an
   owner-supplied loaded model, proving one durable record, declaration, and
   managed-worker terminal result. The loopback fixture does not satisfy this.
3. A reviewed provider table in which each advertised runtime has a passing
   controlled result or an explicit unavailable/refused verdict, and every
   restricted workspace request is either enforced or refused before spawn.
4. Project-scoped Workflow storage, failure/remediation, and history evidence
   that a normal user can reopen after the daemon lifecycle covered by the
   release claim.

Until then, the Graph capability stays development-only and no provider row is
promoted by an unrun endpoint.
