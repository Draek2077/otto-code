---
id: "reference-agentx-python"
kind: "reference"
title: "AgentX-Python"
status: "confirmed"
tags: ["external-reference", "legacy-references-migration"]
reference_disposition: "adopted"
source_url: "https://github.com/AgentX-ai/AgentX-Python"
created_at: "2026-08-08T06:18:22.192Z"
updated_at: "2026-08-08T06:20:09.091Z"
---

# AgentX-Python

<!-- compiled_truth -->

**What it actually is:** the official Python **client SDK for a hosted platform**, not an engine.
Execution lives in their cloud; the SDK exposes `Agent → Conversation → Message`, plus local
instrumentation. Also ships framework integrations (LangChain, CrewAI, OpenAI, Anthropic,
Google) and MCP connectivity.

**Rejected as architecture, and the rejections are the useful part:**

- **The hosted model.** Otto is daemon-owned and local-first; that is the product, not an
  implementation detail.
- **"Workforce with a manager agent"** - a designated manager coordinating specialists is _the
  model picking the topology_. That is the AI flavour the orchestration competitive survey
  (§2.3) explicitly rejected in favour of user-authored deterministic graphs. Adopting it would
  undo the differentiator.
- **`Agent → Conversation → Message`** is a chat model, not a DAG, and the framework wrappers
  are the same in-process layer Otto never occupies.

**Adopted as the vocabulary for the evaluation layer Otto does not have.** This is the first
source surveyed that treats agent telemetry and scoring as first-class product surface rather
than an afterthought, and it closes an area both Gulli Ch. 19–20 and §12 item 6 flag as open:

1. **A trace is a unit with a defined shape** - per run: input, output, latency, tool calls,
   token usage; per tool call: name, input, output, `latency_ms`. That is close to the per-node
   record Otto lacks entirely (`Run` carries `agentCount` and nothing else).
2. **Three scoring mechanisms, not one** - LLM-as-judge (0–10), cosine similarity (embeddings),
   Jaccard (token-set overlap). **The single most useful idea here.** Otto grades with exactly
   one mechanism: an agent judger returning a prose verdict - the most expensive, slowest and
   driftiest of the three, and currently the only one. Deterministic scoring where the answer is
   checkable is the argument for the unbuilt `check` node (a command plus an expectation, no
   model, ground truth rather than opinion).
3. **Patterns** - semantic detection rules evaluated over recorded traces, with severity, run
   automatically when monitoring is on. Otto's analogue is regression detection on graph
   templates: _did this template start behaving differently than it used to?_
4. **Datasets + evaluations as a resource** - scored test cases with a run/finalize/analyze
   shape. The direct input to a golden-graph harness on the T2 local-AI tier (§9).

**The generalizable lesson:** you cannot settle "does orchestrating agents actually work" by
argument, only by measurement - and measurement needs a defined unit, more than one scoring
mechanism, and a corpus of real tasks.

## Timeline

- time: "2026-08-08T06:18:22.192Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:18:22.192Z"
  kind: "evidence"
  summary: "Migrated from `docs/references.md` (heading 5). Legacy status: Read, adopted in part."
- time: "2026-08-08T06:20:09.091Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
