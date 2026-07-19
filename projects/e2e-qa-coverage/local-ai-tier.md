# Tier 2: local-AI live-agent tests (`*.local.spec.ts`)

Live agent-loop coverage without API spend. The E2E daemon's openai-compat provider points at
the user's LM Studio instance (qwen3.6-27b-mtp), so specs exercise the **real** daemon-owned
tool loop — native tool injection, permission gating, compaction, rewind — with real inference.

## Why this tier exists

The mock agent (T1) proves the UI and daemon plumbing but scripts every agent event, so it can
never prove the loop itself: that a prompt actually becomes tool calls, that tool results feed
back correctly, that compaction preserves a usable session, that a permission denial actually
stops the tool. The paid tier (T3) proves that but costs money per run. A local model is the
missing middle: free, private, and — for the openai-compat provider specifically — it _is_ the
production code path, not a stand-in.

## Connection

Never hardcode endpoint or key in specs or docs. Values live in the **repo-root `.env.test`**
(gitignored; this is the file the app harness's global setup loads), read by global setup:

```
E2E_LOCAL_AI_BASE_URL=<LM Studio /v1 endpoint>      # current setup: Tailscale host, port 1235
E2E_LOCAL_AI_API_KEY=<LM Studio key>
E2E_LOCAL_AI_MODEL=qwen3.6-27b-mtp@q4_k_m           # pin one quant; do not "latest"
```

The user's dev `OTTO_HOME` (`packages/desktop/.dev/otto-home/config.json`) already carries a
working openai-compatible provider block — copy its values into `.env.test` once.

## Harness integration (Phase 2)

1. **Global setup:** when `E2E_LOCAL_AI=1` and all three env vars are present, write the
   openai-compatible provider block (env: `OPENAI_BASE_URL`, `OPENAI_API_KEY`) into the forked
   `OTTO_HOME`'s `config.json` after `forkOttoHomeMetadata()` runs. When absent, skip silently —
   T2 specs then fail fast with a clear "local AI not configured" error (no conditional skips
   inside specs; the tier is selected by Playwright project, mirroring how `real-provider` works).
2. **Playwright project:** add a `local-ai` project with `testMatch: ["**/*.local.spec.ts"]` and
   `testIgnore` it from the default project, exactly like `real-provider`.
3. **npm script:** `test:e2e:local-ai --workspace=@otto-code/app`.
4. **Preflight:** global setup pings `GET {baseUrl}/models` and asserts the pinned model is in
   the list — catches "LM Studio not running / model not loaded" in seconds instead of a
   60s spec timeout. (LM Studio JIT-loads on first completion; the preflight also warms it.)

## Writing T2 specs that don't flake

A 27B local model is smart enough to follow one concrete instruction, not smart enough for
multi-step ambiguity. Rules:

- **One imperative, one observable side effect.** "Create a file named `EXACTLY.txt` containing
  exactly `hello-e2e` and nothing else. Do not explain." Then assert the file row appears in
  Changes and the content matches via the daemon — never assert on chat prose.
- **Cap the blast radius.** Low max-tool-rounds for the spec's agent; temp workspace dir;
  60–120s generous timeouts (local inference is slow; MTP helps but budget for it).
- **Retries are legitimate here.** Unlike T1, one retry on a T2 spec is honest — inference is
  nondeterministic. Keep `retries: 1` on the `local-ai` project only.
- **Assert loop mechanics, not intelligence.** Good targets: a tool call row rendered, a
  permission prompt appeared and denial stopped execution, compaction event emitted and the
  session still answers, rewind truncates the timeline. Bad targets: summary quality, wording,
  multi-file refactors.

## Planned specs (build order)

| Spec                                      | Proves                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `openai-compat-loop.local.spec.ts`        | Flagship: prompt → native tool call → file created → diff visible in Changes                                     |
| `openai-compat-permissions.local.spec.ts` | Gated tool prompts; deny stops the tool; dontAsk + deny-responder path                                           |
| `openai-compat-max-rounds.local.spec.ts`  | Configured round cap halts the loop with the cap message                                                         |
| `openai-compat-compaction.local.spec.ts`  | /compact emits compaction, session usable after                                                                  |
| `openai-compat-resume.local.spec.ts`      | Daemon restart mid-session; history fidelity (tool calls + reasoning replayed)                                   |
| `rewind-flow.openai-compat.local.spec.ts` | Reuse `rewind-flow.shared.ts` against the local model                                                            |
| `openai-compat-vision.local.spec.ts`      | Image attachment reaches the model (only if the loaded model has vision; otherwise pin a vision-capable sibling) |

## Resolved decisions

- **Quant pinned:** `qwen3.6-27b-mtp@q4_k_m` (faster; change `E2E_LOCAL_AI_MODEL` in `.env.test`
  to swap).
- **Availability:** LM Studio is an always-on server in this setup, so the runbook needs no
  "start LM Studio" step; the global-setup preflight still fails fast if it's ever down.

## Status

Phase 2 infra is BUILT (uncommitted): `local-ai` Playwright project (240s timeout, 1 retry),
global-setup preflight + provider injection (`maxToolRounds: 25`), `test:e2e:local-ai` npm
script, `helpers/local-ai.ts`, repo-root `.env.test` populated. All planned specs below are
written but not yet run — iron-out pass pending.
