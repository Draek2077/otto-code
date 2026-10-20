---
id: "kv-cache-ram-swap-cross-bleeds-chats-via-lcp-prompt-cache-restore"
kind: "finding"
title: "KV cache RAM swap cross-bleeds chats via LCP prompt-cache restore"
status: "superseded"
tags: ["brain", "kv-cache", "llama.cpp", "prompt-cache", "slots", "concurrency"]
created_at: "2026-08-17T13:44:41.850Z"
updated_at: "2026-08-17T16:44:50.985Z"
---

# KV cache RAM swap cross-bleeds chats via LCP prompt-cache restore

<!-- compiled_truth -->

The "KV cache RAM swapping" feature (profile `cachedChats` → `--cache-ram` on llama-server) can bleed one chat's context into another's generation, and this is an engine-level defect, not a Brain bug.

Mechanism (verified against the vendored llama.cpp b10265 sources in .tmp/): when a task lands on a slot and the prompt cache is active, `get_available_slot` calls `prompt_load`, which scans every parked KV state in RAM and restores the "best" entry selected by longest-common-prefix score. The gate is only `f_keep >= 0.25` — at least 25% of the parked chat's tokens must match the new chat's prefix. On a match it calls `llama_state_seq_set_data_ext(..., id_slot, 0)` (overwriting the slot's KV) AND `prompt = std::move(it->prompt)` (the slot's token bookkeeping becomes the parked chat's tokens). The server then computes `n_past = get_common_prefix(input_tokens)` and processes only the tail — so the model continues from a DIFFERENT chat's KV state and generates conditioned on that chat's entire conversation, including its reasoning.

Why it appears only with a 3rd/4th chat: with 2 chats on a 2-slot profile each chat holds its own slot and the RAM cache is never touched. A 3rd chat evicts (LRU) the least-recently-used slot's KV into the RAM cache; every subsequent re-landing is a restore-by-LCP, and chats sharing the same system prompt + tool schemas easily clear the 0.25-keep gate at long context. The owner of a parked state usually wins its own restore (highest similarity), but when the owner's state has been evicted from the RAM cache (size/token limit pops the oldest entries) or a different parked entry scores higher, another chat's state is loaded instead.

The Brain's `id_slot` pinning cannot prevent this: the pin selects which slot the task lands on, but the engine still runs the prompt-cache load on the chosen slot regardless of the pin. The engine has no chat-identity field in the request (`prompt_cache_key` is not part of the engine contract), so it can only match by tokens — which is exactly the failure.

Immediate mitigation: `--cache-ram 0` (i.e. `cachedChats: 0` / no flag) disables the prompt cache; evicted chats then re-prefill instead of cross-contaminating. Longer term needs an engine-level fix (identity-aware restore) or a much stricter match gate.

Reproduce: 3 chats on a 2-slot profile with `cachedChats >= 1`; watch llama-server logs for `found better prompt with f_keep =` and `selected slot by LRU` lines; the chat whose topic appears in another's thinking block is the one whose state got restored.

## Timeline

- time: "2026-08-17T13:44:41.850Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-all-model-operations-share-scheduler","brain-model-bundles"]
- time: "2026-08-17T13:44:41.850Z"
  kind: "evidence"
  summary: "Read of .tmp/server-context-b10265.cpp: get_available_slot (line ~1576) runs ret->prompt_save + ret->prompt_load on the selected slot for LRU/LCP selections; prompt_load (llama-server-task-b10265.cpp:1741) matches on get_common_prefix with f_keep >= 0.25 gate and restores via llama_state_seq_set_data_ext into id_slot, then prompt = std::move(it_best->prompt); prompt processing (server-context-b10265.cpp:~3201) sets n_past = slot.prompt.tokens.get_common_prefix(input_tokens) and keep_first(n_past), processing only the tail. cache_idle_slots mode (line ~2448) saves ALL idle slots into the prompt cache on every new task start. Brain side: packages/brain/src/runtime/args.ts emits --cache-ram only for measured calibration; packages/brain/src/service/router.ts pinSlot injects id_slot only. User observed cross-chat topic bleed in thinking blocks with 3+ chats, 2 slots, and confirmed it in its own reasoning."
- time: "2026-08-17T16:44:50.985Z"
  kind: "reversal"
  summary: "Corrected by deeper b10441 source analysis: the LCP prompt-cache restore path (f_keep >= 0.25) is DORMANT in Brain's configuration — slot_prompt_similarity defaults to 0 (LCP slot-selection skipped) and every request is pinned via id_slot (LRU branch skipped), so prompt_save/prompt_load never run. The actual bleed is slot-resident KV reuse: slot.release() does not prompt_clear() normal completion tasks, so a handed-off slot re-plays the previous owner's KV via n_past = get_common_prefix(). Superseded in favor of kv-bleed-across-chats-is-slot-resident-kv-reuse-fixed-by-brain-side-exact-key, which records the corrected root cause and the implemented (still unverified-live) Brain-side exact-key ownership fix. The New status: superseded."
