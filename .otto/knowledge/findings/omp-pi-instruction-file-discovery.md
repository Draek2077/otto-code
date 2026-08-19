---
id: "omp-pi-instruction-file-discovery"
kind: "finding"
title: "What instruction files omp loads, and why pi stays unmeasured"
status: "proposed"
tags: ["context-management","providers","omp","pi"]
created_at: "2026-08-19T02:17:03.562Z"
updated_at: "2026-08-19T02:17:03.562Z"
---
# What instruction files omp loads, and why pi stays unmeasured

<!-- compiled_truth -->

omp (Oh My Pi 16.3.6) reads instruction files, and reads a lot of them: eleven discovery providers each nominate a candidate context file, and all are enabled by default. They do not stack. Discovery keys a file by `user` or `project:<depth from cwd>`, and one slot holds one file: the highest-priority provider with a candidate there wins, and the rest are marked shadowed and never sent. That is `ContextLoadPoint.fallbackPaths` semantics exactly, which is how the new `omp` entry in `provider-conventions.ts` models it.

Measured slot orders, first hit wins:

| Slot | Spellings in priority order |
| --- | --- |
| Global | `<omp agent dir>/AGENTS.md`, `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, `~/.config/opencode/AGENTS.md` |
| cwd | `.omp/AGENTS.md`, `.claude/CLAUDE.md`, `AGENTS.md`, `.gemini/GEMINI.md`, `.github/copilot-instructions.md` |
| Above cwd | `.omp/AGENTS.md`, `AGENTS.md` |

Three results contradict the obvious guess:

1. `.claude/CLAUDE.md` outranks the `AGENTS.md` sitting beside it.
2. The Claude, Gemini and GitHub candidates exist only at cwd. Those loaders join their directory onto cwd rather than walking toward the repo root, so an ancestor's `.claude/` is never read while its plain `AGENTS.md` is.
3. omp adopts another harness's global file when it has none of its own, so a user who has never opened omp can still be paying for `~/.claude/CLAUDE.md` on every omp request.

Nothing below cwd ever loads; the walk only climbs. So omp gets no subdirectory scan root and no `conditional` rows. `@imports` are inlined recursively, cycle-guarded, capped at depth 5, and skipped inside fenced and inline code, which matches how the scan treats them.

pi was NOT determined, and is deliberately left out of the registry. omp is a Pi fork sharing Pi's RPC protocol and `PI_*` environment variables, which makes handing pi the omp entry tempting, but omp is the maximalist fork and the whole eleven-provider discovery pass is exactly the surface a fork adds; Pi is described upstream as the minimal terminal agent. The `pi` binary is not installed on this host, no vendor doc was read, and installing a third-party binary was out of scope. No entry means `isContextScanSupported("pi")` stays false and the tab reports that it cannot see, which is the true statement. Copying omp's entry to make the tab look populated would report file weight pi may never send.

Confidence is recorded as `convention` rather than `unverified`. The type comment defines `unverified` as "a subprocess we cannot see into", which is no longer factually true of omp: the payloads were captured verbatim. It cannot be `exact`, because omp composes the request and a newer omp may reorder its providers without Otto knowing.

Not measured, and still a floor: omp's skills and subagents. `resolveSkillRoots` and `resolveAgentRoots` return empty for omp, the same as Codex and OpenCode, so `skills_roster` under-reports for omp rather than guessing.

## Timeline

- time: "2026-08-19T02:17:03.562Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["client-state-topology-and-chat-sync-invariants"]
- time: "2026-08-19T02:17:03.562Z"
  kind: "evidence"
  summary: "Method: rather than infer from token deltas, the omp subprocess's request payloads were captured verbatim. A local Node HTTP server (`.tmp/ctx-probe/capture.mjs`) logged every request body and returned 500, so nothing was ever billed to a model. omp was pointed at it through an isolated config root (`PI_CONFIG_DIR=.omp-probe`) holding a `models.yml` whose only provider was `probe` at `http://127.0.0.1:8791/v1`, `api: openai-completions`. The user's real `~/.omp` config was never modified. For the user-level precedence runs, `HOME`/`USERPROFILE` were pointed at a scratch fake home under `.tmp/`, so `~/.claude`, `~/.codex`, `~/.gemini` and `~/.config/opencode` resolved inside the scratch tree; the three temporary files briefly created under the real home were removed and their absence re-verified.\n\nEvery run: `omp -p --mode json --no-tools --no-title --no-session \"...\"` in a `git init`ed scratch workspace, so `repoRoot` stopped the ancestor walk at the workspace.\n\nThe numbers.\n\n1. Naive differential, as a sanity check. A 9,840-byte `AGENTS.md` of NATO-alphabet words in the workspace root grew the system prompt from 11,689 to 22,054 characters, a delta of 10,365. The file plus its `<file path=\"...\">` wrapper. Without it, the system prompt contained no trace of the content. So omp reads the project `AGENTS.md`: settled.\n\n2. The context block format, read off the captured payload:\n\n```\n<context>\nYou MUST follow the context files below for all tasks:\n<file path=\"...\\withagents\\AGENTS.md\">\n...\n</file>\n<file path=\"C:\\Users\\phili\\.claude\\CLAUDE.md\">\n...\n</file>\n</context>\n```\n\nThat second entry is what exposed the adoption behavior: the user's global Claude file was in an omp request.\n\n3. Multi-sentinel probe. A scratch repo carried a uniquely tagged file at each of fifteen candidate locations, and the run reported which sentinels reached the payload. Loaded: `.omp/AGENTS.md`, `sub/AGENTS.md` (cwd), the omp global. Absent: root `AGENTS.md` (shadowed at the same depth key), `CLAUDE.md`, `AGENTS.local.md`, `.claude/CLAUDE.md`, `.codex/AGENTS.md`, `.gemini/GEMINI.md`, `.github/copilot-instructions.md`, `.cursorrules`, `.cursor/rules/*.mdc`, `.opencode/AGENTS.md`, and `sub/deeper/AGENTS.md` (below cwd).\n\n4. Peel-back runs established each order, one candidate removed at a time.\n\nProject slot, cwd at the repo root:\n- `.omp/AGENTS.md` + `AGENTS.md` + all alternates present -> `.omp/AGENTS.md`\n- minus `.omp/AGENTS.md` -> `.claude/CLAUDE.md` (with `AGENTS.md` still present)\n- minus `AGENTS.md` -> `.claude/CLAUDE.md`\n- minus `.claude/CLAUDE.md` -> `.gemini/GEMINI.md`\n- minus `.gemini/GEMINI.md` -> `.github/copilot-instructions.md`\n\nGlobal slot, against the scratch fake home:\n- all present -> `<fakehome>/.omp/agent/AGENTS.md`\n- minus that -> `.claude/CLAUDE.md`\n- minus that -> `.codex/AGENTS.md`\n- minus that -> `.gemini/GEMINI.md`\n- minus that -> `.config/opencode/AGENTS.md`\n\n5. Ancestor asymmetry. With cwd at `probe2/sub`, `probe2/AGENTS.md` and `probe2/sub/AGENTS.md` both loaded (prompt order: outermost first, global last) while `probe2/.claude/CLAUDE.md` did not, even though the same file at cwd wins its slot outright.\n\n6. Imports. `AGENTS.md` containing `@sub-import.md`, itself containing `@../nested/deep.md`, put both files' sentinels in the payload. Two hops confirmed; the shipped binary's constant is `MAX_AT_IMPORT_DEPTH = 5`.\n\nCorroborating source read: the omp binary is a 155MB single-file bundle that retains its build banners, so `packages/coding-agent/src/discovery/*.ts` is recoverable with `grep -a -b -o` plus `dd`. That is where the provider priorities (native 100, claude 80, agents-md 10), the `key: (H) => H.level === \"user\" ? \"user\" : \"project:\" + depth` shadowing rule, the `disabledProviders` default of empty, and the at-import cycle guard and fence skipping were read. Every one of those was then confirmed against a live payload rather than trusted.\n\nTo finish pi, on a host that has the binary: the same harness works unchanged. Point `pi` at a capture server, run the multi-sentinel repo once, and read which sentinels land. One run settles it."
