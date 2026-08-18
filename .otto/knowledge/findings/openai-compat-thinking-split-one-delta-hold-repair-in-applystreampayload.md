---
id: "openai-compat-thinking-split-one-delta-hold-repair-in-applystreampayload"
kind: "finding"
title: "OpenAI-compat thinking-split: one-delta hold repair in applyStreamPayload"
status: "proposed"
tags: ["openai-compat", "reasoning", "thinking-block", "llama-server", "brain", "streaming"]
created_at: "2026-08-17T03:08:30.029Z"
updated_at: "2026-08-17T18:01:43.146Z"
---

# OpenAI-compat thinking-split: one-delta hold repair in applyStreamPayload

<!-- compiled_truth -->

On OpenAI-compatible connections (not Claude/Codex, which use structured thinking blocks), a model's reasoning can render as "Thinking → stray prose → Thinking" with two live thought blocks. Root cause is upstream: the OpenAI-compatible server (llama-server behind Brain) splits thinking/content on the model's think markers; when the model emits a spurious close tag mid-thought, the rest of the reasoning arrives on the `content` channel. `openai-compat-agent.ts`'s `applyStreamPayload` faithfully renders per-delta channels (`reasoning_content ?? reasoning` → reasoning item, `content` → assistant_message item), so a wire order of reasoning→content→reasoning becomes three blocks. The fix (resilient on our side, since we can't control the upstream server) is a one-delta look-ahead hold in `applyStreamPayload` (openai-compat-agent.ts): while a reasoning block is open and no prose has settled for the round, the FIRST content delta is held (`heldContent` on `ActiveTurn`). If the next delta is `reasoning_content` it was a leak and is re-emitted as reasoning (one continuous thought); if the next event is content / a tool call / stream end / interrupt, it was genuine prose and flushes via `settleHeldContentAsProse`. Once prose settles, the guard is off for the rest of the round, so a legitimate reasoning→content→reasoning interleaving is never reclassified. Confined to openai-compat-agent.ts (ActiveTurn + applyStreamPayload + settleHeldContentAsProse + heldContent/contentSettled fields); does not touch Claude/Codex/ACP providers.

## Timeline

- time: "2026-08-17T03:08:30.029Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-17T03:08:30.029Z"
  kind: "evidence"
  summary: "packages/server/src/server/agent/providers/openai-compat-agent.ts: parseStreamChunk (~895 `reasoning_content ?? reasoning`), applyStreamPayload hold/flush, settleHeldContentAsProse, ActiveTurn.heldContent/contentSettled, stream-end + round-reset + interrupt flush sites. Regression tests in openai-compat-agent.test.ts (4 cases: fold-back, settle-on-continue, content-only no-op, settle-on-tool-call). 121/121 passing; tsgo typecheck clean."
- time: "2026-08-17T18:01:43.146Z"
  kind: "evidence"
  summary: "Repair withdrawn (2026-08-17): the one-delta hold was removed from applyStreamPayload. Mechanism of the regression: after a fold, `contentSettled` stays false and `heldContent` is null, so the guard re-arms for the rest of the round. On the very wire shape the repair existed for - a server that alternates reasoning_content/content per delta - every content delta is held and then folded into the thought. The round closes with `roundText === \"\"` and no tool calls, so runToolLoop's `if (toolCalls.length === 0) return` (openai-compat-agent.ts ~3286) ends the turn on a thinking block having said and done nothing. Reported symptom: \"thinking breaks all actions and often ends the turns prematurely, turns end on thinking almost every turn.\" Ruled out as contributors: the stall guard and the per-round text budget from 02fb1f670 - neither has ever fired (\"Stall guard tripped\" and \"round text budget\" both 0 occurrences across both ~7 MB daemon.log files, installed and dev). Content is now always rendered as prose; the bleed is treated as cosmetic. Regression test replaced with \"keeps content as prose on a stream that flips back to thinking\" (openai-compat-agent.test.ts); 121/121 passing, tsgo typecheck and oxlint clean. Open: the original Thinking → stray prose → Thinking rendering is unfixed, and any future fix must be lossless - a misrendered thought is cosmetic, a swallowed answer ends the turn."
  source: "packages/server/src/server/agent/providers/openai-compat-agent.ts"
