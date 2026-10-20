---
id: "reference-agentic-design-patterns"
kind: "reference"
title: "Agentic Design Patterns"
status: "confirmed"
tags: ["external-reference", "legacy-references-migration"]
reference_disposition: "unevaluated"
source_url: "https://github.com/evoiz/Agentic-Design-Patterns"
created_at: "2026-08-08T06:18:21.455Z"
updated_at: "2026-08-08T06:20:08.419Z"
---

# Agentic Design Patterns

<!-- compiled_truth -->

**What it actually is:** the full 424-page PDF of Gulli's book _Agentic Design Patterns: A Hands-On
Guide to Building Intelligent Systems_, plus per-chapter Jupyter notebooks. 21 chapters, 7
appendices. Examples use LangChain and the OpenAI APIs, and reference AutoGPT, AutoGen and CrewAI.
Author royalties go to Save the Children. This is a **book with code**, not a library - the value is
the taxonomy and the prose, and it is the most complete vocabulary in this group.

**The 21 chapters:** Prompt Chaining · Routing · Parallelization · Reflection · Tool Use · Planning ·
Multi-Agent Systems · Memory Management · Learning and Adaptation · Model Context Protocol (MCP) ·
Goal Setting and Monitoring · Exception Handling and Recovery · Human-in-the-Loop · Knowledge
Retrieval (RAG) · Inter-Agent Communication (A2A) · Resource-Aware Optimization · Reasoning
Techniques · Guardrails/Safety Patterns · Evaluation and Monitoring · Prioritization · Exploration
and Discovery.

**Relevant to Otto - high value:**

- **Ch. 11 Goal Setting and Monitoring**, **Ch. 12 Exception Handling and Recovery**, **Ch. 13
  Human-in-the-Loop** are the three chapters that describe things Otto's graph engine has as
  first-class nodes (budget/ceiling, retry policy, Gate). Read them against
  [orchestration-node-capabilities.md](orchestration-node-capabilities.md) - this is the closest
  published treatment of the same design space.
- **Ch. 16 Resource-Aware Optimization** is the missing prose for [token-economy.md](token-economy.md): Otto has the measurements but no framework for reasoning about them.
- **Ch. 8 Memory Management** and **Ch. 9 Learning and Adaptation** are the direct input to
  personality memory, now shipped ([agent-personalities.md § Memory](agent-personalities.md#memory-accrued-lessons)).
  Read them against what shipped: the scoping question resolved to `global ∪ thisProject`, resolved
  rather than configured.
- **Ch. 19 Evaluation and Monitoring** and **Ch. 20 Prioritization** bear on what an orchestration
  run should report back, which is an open area.
- **Appendix G (coding agents)** and **Appendix E (CLI agents)** are the parts closest to Otto's
  actual product.

**Not relevant to Otto:**

- **Ch. 1–7 (the core patterns)** - the same in-process-agent-loop layer as above. The provider CLI
  owns all of it.
- **Ch. 15 Inter-Agent Communication (A2A)** - Otto's agents communicate through the daemon and
  through the filesystem, deliberately. A peer-to-peer agent protocol is a different architecture,
  and adopting one would undo the daemon-owns-execution property that
  the orchestration survey identifies as the differentiator.
- **The LangChain/CrewAI/AutoGen example code** throughout. Framework-specific and irrelevant for
  the same reason as above.

**Caveat:** it is a broad survey book. Expect the chapters to be shallower than the specific
engineering write-ups in §2.2 - use it for vocabulary and completeness checks, not for depth.

## Timeline

- time: "2026-08-08T06:18:21.455Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:18:21.455Z"
  kind: "evidence"
  summary: "Migrated from `docs/references.md` (heading 2). Legacy status: Unevaluated."
- time: "2026-08-08T06:20:08.419Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
