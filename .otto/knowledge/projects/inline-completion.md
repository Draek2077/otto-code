---
id: "inline-completion"
kind: "project"
title: "Inline Completion"
status: "confirmed"
tags: ["project-charter", "legacy-projects-migration"]
delivery_status: "charter"
created_at: "2026-08-08T06:17:55.518Z"
updated_at: "2026-08-08T06:19:47.437Z"
---

# Inline Completion

<!-- compiled_truth -->

# Inline completion

**What we will build:** ghost-text code completion in the Otto editor - inline
suggestions as you type, accepted with Tab - driven by **whatever provider/model the
user selects**. This is an **Otto feature, not an otto-brain feature.** A FIM-trained
local model served by the brain is the highest-quality proof implementation, but the
capability must reach every provider Otto supports (Claude, OpenAI-compatible, brain,
…), because that is this fork's rule: design provider-agnostic first, treat
single-provider support as the proof, not the finish line.

Status lives in [`../README.md`](../README.md), not here.

> Terminology: the final UI label must follow [`../docs/glossary.md`](../docs/glossary.md)
> (the UI label wins, no synonyms). "Inline completion" is the working name here; do not
> assume it is the shipped label.

## The shape: one capability, many implementations

Four provider-agnostic layers. Only the bottom layer knows which provider answers.

### 1. Editor UI (app)

A CodeMirror 6 ghost-text extension in the React-free `editor/editor-core.ts` layer
(so it also works inside the native webview): debounced request-on-idle, render the
suggestion inline, accept-on-Tab, cancel on any other keystroke, request cancellation
on the wire. Provider-agnostic - it consumes a completion, it does not know the source.
The editor has **no** inline-completion today; every existing "autocomplete" in the app
is composer assistance (@-mentions, slash commands), not code completion.

### 2. A provider-neutral completion capability + daemon RPC

A new daemon capability: given `{prefix, suffix, cross-file context, language, cursor}`
return completion text (+ a cheap "no suggestion" answer). Rides a
`server_info.features.inlineCompletion` flag with a `COMPAT(inlineCompletion)` cleanup
tag; a new dotted-namespace RPC pair per [`../docs/rpc-namespacing.md`](../docs/rpc-namespacing.md).
The UI talks to this, never to a provider directly. **Protocol stays backward-compatible;
the feature degrades to "update the host" on old daemons - no fallback path.**

### 3. Task-scoped provider selection (not new ground)

The user picks **which provider/model does completion, independently of their chat/agent
provider.** Otto already pins providers per non-chat task -
`metadataGeneration.providers` + the per-provider `generateBareCompletion` primitive
(see [`../docs/providers.md`](../docs/providers.md) and the Providers & accounting rows in
[`../README.md`](../README.md)). Inline completion is the same pattern, specialized for
latency: an `inlineCompletion.provider`/model setting with a sensible default.

### 4. Per-provider implementation strategies (the parity proof)

Each provider fulfils the capability its own way, or declares it unsupported:

- **FIM-native** - llama.cpp / the brain with a FIM-trained model (Qwen2.5-Coder,
  DeepSeek-Coder, StarCoder, CodeLlama): the real `/infill` endpoint with prefix/suffix
  sentinel tokens. Best local quality + latency. Needs, in the brain: a **managed
  low-latency `/infill` lane** (its own fast queue, no reasoning budget, small token cap)
  and **FIM-token detection in `gguf.ts`** to know which local models qualify. Today the
  brain router only manages `/v1/chat/completions` + `/v1/messages`; `/infill` only works
  by accident when the right model is already resident.
- **Prompt-synthesized** - Claude, OpenAI, any chat model: a completion produced by a
  chat request framed as fill-in-the-middle (prefix/suffix in the prompt, low max-tokens,
  stop sequences, no reasoning). Not true FIM, but works for every chat provider - this is
  what makes the feature reach all providers equally. Builds on the existing
  `generateBareCompletion` per-provider primitive where present.
- **Unsupported** - a provider that can do neither declares it; the UI offers only capable
  providers for the completion task.

## Honest guardrails (design must carry these)

- **Latency budget.** Per-keystroke completion on a hosted API is slow; the request path
  must be debounced, cancellable, and time-boxed, and a laggy provider must degrade
  gracefully rather than stutter the editor.
- **Cost awareness.** Hosted per-keystroke completion is expensive; warn / rate-limit /
  make the default conservative. Do not silently bill a chat provider for keystrokes.
- **Default sensibly.** Prefer a fast local completion model when one is present
  (composes with the brain's coding-model metadata + FIM detection); otherwise default
  **off** - never surprise the user with cost or latency.

## Sequencing

Greenfield across app + server/protocol + at least one provider. A sensible first slice
is the **prompt-synthesized** strategy behind the UI + RPC (proves the capability against
Claude/OpenAI, no brain dependency), with the brain's **FIM-native lane** as the
quality-proof follow-on. This ordering makes the provider-agnostic layer the foundation
and the brain the proof - the correct shape for this fork.

## Relationship to the brain work

The brain's shipped coding capabilities (catalog metadata, coding-aware model selection)
and the future FIM-token detection feed the "default to a fast local completion model"
path, but they are **inputs**, not the feature. See
[`../brain-coding-capabilities/brain-coding-capabilities.md`](../brain-coding-capabilities/brain-coding-capabilities.md).

## Timeline

- time: "2026-08-08T06:17:55.518Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:17:55.518Z"
  kind: "evidence"
  summary: "Migrated from `projects/inline-completion/inline-completion.md` and the legacy `projects/README.md` ledger. Legacy status: Charter. Ledger summary: Ghost-text code completion in the editor - **a provider-neutral Otto feature**, not a brain feature - driven by whatever provider the user picks (Claude, OpenAI-compatible, brain). FIM is one implementation strategy (FIM-trained local models via llama.cpp `/infill`); chat providers get prompt-synthesized completion. Task-scoped provider selection like `metadataGeneration.providers`; latency- and cost-guarded, default off. Reframed out of [brain-coding-capabilities](brain-coding-capabilities/brain-coding-capabilities.md) on 2026-07-30"
- time: "2026-08-08T06:19:47.437Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
