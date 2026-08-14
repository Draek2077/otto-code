---
id: "qwen3-8-27b-effort-discovery-gap"
kind: "finding"
title: "Qwen3.8 27B effort-tier discovery gap"
status: "proposed"
tags: ["brain", "qwen", "reasoning", "effort", "remote-brain"]
created_at: "2026-08-14T19:12:30.466Z"
updated_at: "2026-08-14T19:12:30.466Z"
---

# Qwen3.8 27B effort-tier discovery gap

<!-- compiled_truth -->

Qwen3.8 27B natively supports `reasoning_effort` tiers `low`, `medium`, and `xhigh`, with thinking enabled by default and `xhigh` as its default tier. Otto Brain has the plumbing to advertise per-model `reasoning_efforts`, but the curated Qwen3.8 catalog entry declares only `thinking: true`, so a Brain endpoint falls back to the binary Off/On control. Even if the host advertises `xhigh`, Otto's OpenAI-compatible reasoning-effort union currently excludes it and its generic default-selection policy prefers `medium`. The deployed Greyskull provider snapshot also does not presently list Qwen3.8 among its discoverable model entries while reporting Qwen3.8 as selected, so the raw remote `/v1/models` response and installed runtime build require an on-host probe before implementation is confirmed.

## Timeline

- time: "2026-08-14T19:12:30.466Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-14T19:12:30.466Z"
  kind: "evidence"
  summary: "Official Qwen model card fetched from `https://huggingface.co/Qwen/Qwen3.8-27B/raw/main/README.md` on 2026-08-14 states that Qwen3.8-27B supports `reasoning_effort` values `xhigh` (default), `medium`, and `low`, plus per-request thinking disablement. Its tokenizer config contains a template branch accepting exactly those values and rejecting others. `packages/brain/config/downloads.json` defines Qwen3.8 with `thinking: true` but no `reasoningEfforts`; `packages/brain/src/service/router.ts` would expose `model.reasoningEfforts` as `reasoning_efforts`; and `packages/server/src/server/agent/providers/openai-compat-feature-definitions.ts` currently accepts only off/on/low/medium/high. Live `otto-brain` model discovery on 2026-08-14 returned the generic Off/On pair for all discoverable entries and did not include the selected Qwen3.8 model."
