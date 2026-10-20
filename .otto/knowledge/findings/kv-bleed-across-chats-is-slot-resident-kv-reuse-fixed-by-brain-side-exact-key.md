---
id: "kv-bleed-across-chats-is-slot-resident-kv-reuse-fixed-by-brain-side-exact-key"
kind: "finding"
title: "KV bleed across chats is slot-resident KV reuse, fixed by Brain-side exact-key slot ownership"
status: "proposed"
tags: ["brain", "kv-cache", "llama.cpp", "slots", "prompt-cache", "concurrency", "ownership"]
created_at: "2026-08-17T16:44:42.849Z"
updated_at: "2026-08-17T16:44:42.849Z"
---

# KV bleed across chats is slot-resident KV reuse, fixed by Brain-side exact-key slot ownership

<!-- compiled_truth -->

Cross-chat KV bleed (3+ chats on fewer slots; chat B's thinking discusses chat A's topics) is caused by **slot-resident KV reuse in llama-server**, not by the RAM prompt-cache (LCP) restore path. Verified against b10441 source: `slot.release()` does not `prompt_clear()` for normal completion tasks, so a released slot keeps its owner's KV; the next task pinned to that slot (`id_slot`) reuses it via `n_past = slot.prompt.tokens.get_common_prefix(input_tokens)` (plus possible `n_cache_reuse` chunk shifts), so the model continues from another chat's KV. The LCP prompt-cache restore (`--cache-ram`, `f_keep >= 0.25`) is **dormant in Brain's configuration**: `slot_prompt_similarity` defaults to 0 (LCP slot-selection skipped) and Brain pins every request with `id_slot` (LRU branch skipped), so `update_cache` stays false and `prompt_save`/`prompt_load` never run.

**Fix (implemented, unverified live):** Brain-side exact-key slot ownership, in the Brain TypeScript layer, no engine rebuild. Invariant: a slot may only hold KV for the chat it was filled for. `prompt_cache_key` is the sole ownership key (the standard OpenAI field the router already extracts as the scheduler's `session`); no fuzzy similarity. The scheduler tracks `slotOwners: Map<slotId, sessionKey | null>` (null = keyless client) and, at admission, erases the slot **only** when it has a previous owner and `previous !== job.session` (fresh slot: no erase; same chat: reuse its warm KV; different chat or keyless client: erase first). Erasing at settle was deliberately avoided — the engine keeps a released slot's KV indefinitely, which is exactly what the same chat wants back on its next turn. Owner map clears idempotently on relaunch: `#pass` when a turn begins on a different model, and on the supervisor's `starting` state (same-model relaunch / live profile edit). Erase transport: `POST /slots?action=erase&id_slot=N` — query string, **empty body**: the engine's `get_param` reads only query + path params (`tools/server/server-http.h` / `.cpp` in b10441, identical in b10265), so a body-only request answers 400 "Invalid slot ID" and silently no-ops. The route is gated on `--slot-save-path` (`server-context.cpp:4526`), now passed by `supervisor.ts` (scratch dir `<brain root>/slot-saves`) via `runtime/args.ts`. Two bugs found and fixed by the rewritten scheduler tests: (1) fresh-slot sentinel — `slotOwners.get(slotId) ?? null` conflated "no owner entry" with "owned by a keyless client", making the first keyed job erase an empty slot (fixed with `slotOwners.has(slotId)`); (2) the wire shape above.

**Status: implemented and unit-tested, NOT proven resolved.** `packages/brain` suite green (34 files / 409 tests, incl. ownership tests: handoff erase, same-chat reuse, relaunch clear, keyless clients, erase-failure degradation, ordering; and a wire-shape pin in `router.test.ts`). Open: live reproduction with 3+ chats on 2 slots to confirm the bleed is gone.

Supersedes the prior diagnosis recorded as `kv-cache-ram-swap-cross-bleeds-chats-via-lcp-prompt-cache-restore` (LCP prompt-cache restore), which was a dormant path in Brain's configuration, not the cause.

## Timeline

- time: "2026-08-17T16:44:42.849Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["kv-cache-ram-swap-cross-bleeds-chats-via-lcp-prompt-cache-restore","brain-all-model-operations-share-scheduler","brain-completion-queue-reliability"]
- time: "2026-08-17T16:44:42.849Z"
  kind: "evidence"
  summary: "b10441 sources fetched into .tmp/ (b10441-server-context.cpp, b10441-server-task.h, b10441-server-common.cpp, b10441-arg.cpp) + tools/server/server-http.{h,cpp} fetched 2026-08-18. Key lines: release() ~795-815 (no prompt_clear for normal tasks); get_available_slot 1487 (pinned slot honored 1493; LCP block 1501 gated on slot_prompt_similarity, default 0; LRU branch 1575 skipped when pinned; prompt_save/prompt_load 1585-1595 dormant); prompt processor ~3120-3230 (n_past = get_common_prefix; n_cache_reuse shifts 3140-3185); POST /slots gate 4526 (slot_save_path), action dispatch 4529-4552, handle_slots_erase 5206 (task only, body never parsed); server-task.h SERVER_TASK_TYPE_SLOT_ERASE. Brain side: packages/brain/src/service/scheduler.ts (slotOwners, #eraseFor, admission-time ownership check with hasPrevious sentinel, relaunch reset in #pass), router.ts (createSlotEraser/eraseSlot query-string transport, session extraction from prompt_cache_key ~916-923, starting-state reset), serve.ts (shared scheduler wiring), runtime/args.ts (--slot-save-path), service/supervisor.ts (slot-saves dir). Full session log: .tmp/kv-bleed-fix-results.md §2, §9."
