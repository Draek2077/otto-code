---
id: "a-blank-assistant-chunk-between-reasoning-deltas-splits-one-thought-into-two"
kind: "finding"
title: "A blank assistant chunk between reasoning deltas splits one thought into two blocks"
status: "proposed"
tags: ["app", "timeline", "reasoning", "thinking-block", "streaming", "reducers"]
created_at: "2026-08-18T00:04:27.651Z"
updated_at: "2026-08-18T00:04:27.651Z"
---

# A blank assistant chunk between reasoning deltas splits one thought into two blocks

<!-- compiled_truth -->

A Thinking block splits in two, mid-word, with nothing rendered between the halves, whenever a whitespace-only assistant chunk arrives between two reasoning deltas. Two rules in the app disagreed about what counts as an item. `shouldFlushHead` (packages/app/src/types/stream.ts) flushes the head whenever the incoming streamable lane differs from the head's current one, so an `assistant_message` after a `thought` commits the head to tail. `appendAssistantMessage` then drops that chunk for having no visible text (its `normalizeChunk().hasContent` guard) once it cannot extend an assistant message already in head. The flush has already happened, so the next reasoning delta finds an empty head and opens a fresh thought. Net effect: one thought becomes two, split at whatever character the model was mid-word on, with no visible item between them. This is unrelated to backticks: they only make it conspicuous, because a split inside an inline-code span leaves an unclosed backtick that renders as a literal dark character. It is also distinct from the reasoning-budget bleed, where prose genuinely does follow the thought. The trigger is common because providers emit a blank line immediately after a closing think tag, and a reasoning budget that forces a thought closed mid-sentence produces several of those per turn - so the budget finding and this one compound. Fixed by making the flush rule agree with the drop rule: an assistant chunk with no visible text does not flush the head when the head's last streamable is not itself an assistant message. Real prose still separates two thoughts, because that genuinely is a new lane.

## Timeline

- time: "2026-08-18T00:04:27.651Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-s-reasoning-budget-is-what-makes-thinking-bleed-into-prose-on-openai","client-state-topology-and-chat-sync-invariants"]
- time: "2026-08-18T00:04:27.651Z"
  kind: "evidence"
  summary: "Reproduced against the real reducers with `processAgentStreamEvents`: events [reasoning \"figure out what the\", assistant_message \"\\n\\n\", reasoning \" other agent did.\"] produced two thought items, `[\"figure out what the\", \" other agent did.\"]`, and no assistant_message item. The same events without the blank chunk produced one thought, \"figure out what the other agent did.\" With visible prose instead of whitespace the result is thought/assistant_message/thought, which is correct. Matches user screenshots: two adjacent Thinking blocks split at \"what the\" / \" other agent did\" with nothing between, and a split mid inline-code span at \"`hostingProfileId: string |\" / \" null`\". Fix in packages/app/src/types/stream.ts: new `incomingTextIsVisible` helper mirroring `normalizeChunk().hasContent`, and an early `return false` in `shouldFlushHead` for an invisible assistant chunk when `lastStreamable.kind !== \"assistant_message\"`. Regression tests added to session-stream-reducers.test.ts (both the merge case and the still-splits-on-prose case); 86 tests in that file, 261 across packages/app/src/timeline and subagents, typecheck and oxlint clean. Separate defect found while reproducing and NOT fixed: when a canonical timeline row fails `reconcileOverlappingProjectedReasoning`'s `projectedText.startsWith(item.text)` guard, the row is concatenated onto the live thought instead of replacing it, duplicating text - two canonical rows against a merged live thought yielded \"Hello worldHello world and more\", and a partly-overlapping row yielded \"Hello worldworld tail\"."
