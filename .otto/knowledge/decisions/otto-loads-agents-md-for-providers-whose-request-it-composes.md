---
id: "otto-loads-agents-md-for-providers-whose-request-it-composes"
kind: "decision"
title: "Otto loads AGENTS.md for providers whose request it composes"
status: "proposed"
tags: ["context-management","providers","openai-compat","agents-md"]
created_at: "2026-08-19T00:53:57.113Z"
updated_at: "2026-08-19T02:02:32.400Z"
---
# Otto loads AGENTS.md for providers whose request it composes

<!-- compiled_truth -->

Providers that declare the `ownsContextPayload` capability (the OpenAI-compatible family: `otto-brain` and every user-configured endpoint) receive the workspace's instruction files from the daemon, because they have no process of their own to read them.

Load order: `$OTTO_HOME/AGENTS.md`, then `<project root>/AGENTS.md`, then each directory from the project root down to cwd, outermost first so the most specific rules land last. At each load point `AGENTS.md` wins and `CLAUDE.md` is a per-directory fallback, so a repo carrying both loads one file rather than two.

Four decisions that hold this shape:

1. **Global scope is `$OTTO_HOME/AGENTS.md` only.** Not `~/.claude/CLAUDE.md` or `~/.codex/AGENTS.md`: silently inheriting another harness's global file imports its token weight into sessions the user never pointed at it.
2. **Gating is a capability, never a provider id.** The family has no single id at runtime, and loading these files for a CLI-backed provider that already reads them would send the repo's instructions twice and bill for both.
3. **The scan and the prompt are two readings of one resolver.** `loadInstructionFiles` calls `scanContextGraph`, the same function the Context Management tab reports from, which is what makes the report's `confidence: "exact"` true by construction rather than by promise.
4. **Subdirectory files below cwd are deferred.** Matching Claude's lazy subtree loading means injecting mid-turn with its own dedupe and compaction story, so the convention returns no subdirectory scan root and the tab stays silent rather than showing conditional weight that never arrives.

Loading is runtime-only, like personality memory and the knowledge catalog: it lands on the launch config and never on the stored one.

## Timeline

- time: "2026-08-19T00:53:57.113Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["provider-neutral-capability-parity-defines-done","remote-brain","brain-coding-capabilities"]
- time: "2026-08-19T00:53:57.113Z"
  kind: "evidence"
  summary: "Shipped in commit 9daef5833 (`feat(server): load AGENTS.md for the providers Otto drives itself`), 14 files, 400 related tests green.\n\nImplementation: `packages/server/src/server/agent/context-management/instruction-files.ts`, applied at the spawn choke point as `applyInstructionFiles` in `agent-manager.ts`; `OPENAI_COMPAT_CONVENTION` and `ContextLoadPoint.fallbackPaths` in `provider-conventions.ts`; `ownsContextPayload` on `AgentCapabilityFlags`. Documented in `docs/context-management.md` (\"Who loads the instruction files\") and `docs/providers.md`.\n\nTwo pre-existing Context Management defects were found and fixed in the same change, both of which had made the tab under-report silently:\n\n- `resolveCategoryVisibility` tested `provider === \"openai-compat\"`, an id no provider is registered under. `system_prompt` and `mcp_tools` therefore reported `not_visible` on every host, including the one provider Otto measures completely.\n- `WorkspaceContextRuntime.systemPromptText` and `.mcpToolsText` were declared and documented as exact, but `resolveRuntime` never populated either, so those rows could not have carried a number even once the id test was corrected. `AgentSession.describeContextPayload()` now supplies both, read per report because the tool payload narrows with the session's mode and workspace-access ceiling.\n\nVerified by a test asserting the scan and the loader resolve the identical file set, so a future divergence fails rather than quietly making the tab describe a session that does not exist."
- time: "2026-08-19T02:02:32.400Z"
  kind: "evidence"
  summary: "Deferral #4 is now implemented: subdirectory instruction files below cwd load conditionally, from the daemon-owned tool loop. `OPENAI_COMPAT_CONVENTION.resolveSubdirectoryScanRoot` returns **cwd** (not the project root, because everything above cwd is already a fixed load point, which makes the two halves exact complements) and `subdirectoryFileNames` is `[\"AGENTS.md\", \"CLAUDE.md\"]` - the same one-slot-several-spellings rule as the fixed points. The Context Management tab therefore shows these as `conditional` weight.\n\nFive design decisions, each the answer to a way this could break silently:\n\n1. **Injection lands at the round boundary as its own system message.** Not inside the tool result: `pruneToolOutputs` truncates aged tool results during compaction, so the rules would decay into a `[... chars pruned ...]` marker while the model still believed it was following them. Not spliced at the moment the tool ran either: that puts a message between an assistant `tool_calls` message and its `tool` results, which strict OpenAI-compatible servers reject. After the round's results and before the next request is built, the conversation is wire-valid and the model sees the file on the next round anyway.\n2. **First visit wins, keyed by `contextPathKey`** (exported from the scanner, case-insensitive on Windows), so a subtree touched twenty times loads once and two spellings of one directory cannot inject twice.\n3. **Compaction pins them.** `serializeConversationForCompaction` drops system messages, so an injected file in the summarize region would be neither summarized nor kept - it would simply stop existing. Pinned messages are lifted out of both regions and re-inserted directly under the rebuilt system prompt.\n4. **Rewind un-injects; resume does not.** The conversation is the record: `subtreeInstructionDir` on the message is the injection's identity (persisted and restored), the already-injected set is rebuilt from `this.messages` after every rewrite, and rewinding past an injection makes that subtree loadable again - what is not in the conversation is not being followed.\n5. **`@imports` reuse the one resolver.** `loadSubdirectoryInstructionFile` hands `scanContextGraph` an explicit load point (`ScanContextGraphOptions.loadPoints`) instead of walking a second time, so a subdirectory file gets the same recursive inlining, cycle guard and depth cap as the root's.\n\nWhich directories a tool call touched is `providers/openai-compat-subtree-instructions.ts`, deliberately shape-agnostic (builtin tools name their target `path`, Otto/MCP tools have shapes the loop cannot know, `run_command` hides paths in a shell string): every string argument is split on whitespace and any token carrying a path separator is a candidate. That test is exact rather than heuristic - a token with no separator can only name a file in cwd, whose directory holds no conditional weight.\n\nVerification: `instruction-files.test.ts` now pins both directions of the invariant - the fixed scan equals the loader, and the conditional scan equals what the subtree loader can inject, per-directory fallback included. 251 tests green across the openai-compat agent suite, the new `openai-compat-subtree-instructions.test.ts`, and the whole `context-management/` directory; server typecheck and lint clean."
  source: "Implementation in packages/server: openai-compat-agent.ts, openai-compat-subtree-instructions.ts, context-management/{instruction-files,context-graph-scanner,pr"
