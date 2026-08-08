---
id: "reference-all-agentic-architectures"
kind: "reference"
title: "all-agentic-architectures"
status: "confirmed"
tags: ["external-reference", "legacy-references-migration"]
reference_disposition: "unevaluated"
source_url: "https://github.com/FareedKhan-dev/all-agentic-architectures"
created_at: "2026-08-08T06:18:21.072Z"
updated_at: "2026-08-08T06:20:08.059Z"
---

# all-agentic-architectures

<!-- compiled_truth -->

**What it actually is:** a Python library plus 35 executed Jupyter notebooks, one per architecture,
built on **LangGraph** state machines with a uniform `Architecture` class interface, 283 unit tests,
9 LLM provider integrations, and a self-scored 17-task benchmark (README reports 33/42 correct,
78%). It is simultaneously a library, a textbook and a benchmark. Crucially, the theory is written
against captured real runs rather than hypothetical examples - which is what makes it worth reading
rather than skimming.

**The 35, by family:** Reasoning & Reflection (5) - Reflection, Reflexion, Chain-of-Verification,
Self-Discover, Constitutional AI. Sampling & Search (5) - Self-Consistency, Tree of Thoughts, LATS,
Mental Loop, Ensemble. Retrieval/RAG (5) - Agentic RAG, Corrective RAG, Self-RAG, Adaptive RAG,
GraphRAG. Memory (5) - Episodic + Semantic, Graph Memory, MemGPT, Voyager, Agent Workflow Memory.
Tools & Actions (6) - Tool Use, ReAct, Planning, Plan-Execute-Verify, SWE-Agent, BrowserAgent.
Multi-Agent (5) - Multi-Agent, Blackboard, Debate, STORM, Meta-Controller. Safety & Routing (3) -
Dry-Run, Reflexive Metacognitive, Computer Use. Specialty (2) - RLHF Self-Improvement, Cellular
Automata.

**Relevant to Otto - high value:**

- **Plan-Execute-Verify** and **Chain-of-Verification** are the closest published statements of what
  `projects/agent-orchestration` already calls the requirements-immutable / audit-every-bullet loop,
  and what an orchestration graph's Check node is for. Read before finalising the verifier node's
  structured output.
- **Meta-Controller** and **Blackboard** are the two multi-agent topologies Otto's graph engine can
  express but has no template for. Blackboard in particular maps onto artifacts-as-shared-state,
  which is the design decision already taken in `orchestration-design.md` Part 6 (files, not
  reducers).
- **Agent Workflow Memory** and **Voyager** are the two memory architectures that are about
  _accruing reusable skills from completed work_ - directly the "reusable coding pattern template"
  idea, from the memory side rather than the graph side. These two are the single most relevant
  items in the repo for the planned initiative.
- **SWE-Agent** and **Dry-Run** speak to coding-specific agent behaviour and to a safety posture
  Otto already has an analogue of ([safe-unattended.md](safe-unattended.md)).

**Relevant but redundant:** ReAct, Tool Use, Planning, Reflection - Otto does not implement these;
the provider CLIs it supervises do. Reading them clarifies vocabulary, not implementation.

**Not relevant to Otto:**

- **The whole LangGraph implementation layer.** Otto never calls a model - the daemon spawns Claude
  Code, Codex, Copilot CLI, OpenCode or Pi as OS processes, each owning its own model connection and
  tool loop. The reasoning about node/state/checkpoint transfers; the code does not. This is the
  same conclusion reached independently in `orchestration-design.md` Part 8.
- **The RAG family (5) and the retrieval plumbing.** Otto has no corpus and no embeddings; its
  "retrieval" is a file explorer and an LSP. Interesting as background for a future memory-search
  design, not as architecture.
- **Cellular Automata, RLHF Self-Improvement, Ensemble, Self-Consistency.** Sampling-time techniques
  that assume you control the inference loop. Otto does not.
- **The benchmark.** Self-scored on its own 17 tasks; treat the 78% as a smoke test that the
  notebooks run, not as evidence any architecture is better than another.

## Timeline

- time: "2026-08-08T06:18:21.072Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:18:21.072Z"
  kind: "evidence"
  summary: "Migrated from `docs/references.md` (heading 1). Legacy status: Unevaluated."
- time: "2026-08-08T06:20:08.059Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
