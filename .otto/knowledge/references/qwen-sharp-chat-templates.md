---
id: "qwen-sharp-chat-templates"
kind: "reference"
title: "Qwen Sharp chat templates"
status: "proposed"
tags: ["qwen", "openai-compatible-provider", "chat-template", "system-prompt"]
reference_disposition: "read"
source_url: "https://huggingface.co/peculiar-ragdoll/Qwen-Sharp-Chat-Templates"
created_at: "2026-08-12T03:04:50.273Z"
updated_at: "2026-08-12T03:04:50.273Z"
---

# Qwen Sharp chat templates

<!-- compiled_truth -->

A Qwen 3.5/3.6 chat-template variant combines froggeric's fixed template with an appended terseness system prompt. Its model card reports improved single-turn quality/token figures on one Qwen3.6-27B evaluation, but warns that preserving thinking can regress multi-turn coding/audit latency by 19% in a user measurement. It is a candidate reference for Otto's local OpenAI-compatible provider and personality prompts, not an adopted configuration.

## Timeline

- time: "2026-08-12T03:04:50.273Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-12T03:04:50.273Z"
  kind: "evidence"
  summary: "User shared Reddit thread https://www.reddit.com/r/LocalLLM/comments/1vju23x/ . The author identifies the portable change as a chat template with force-appended system prompt, while the model-card caveat recommends testing preserve_thinking=false for multi-turn agentic workloads."
