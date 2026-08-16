---
id: "llama-cache-reuse-unevaluated"
kind: "finding"
title: "llama.cpp --cache-reuse is unevaluated for Otto's traffic"
status: "proposed"
tags: ["brain", "kv-cache", "prompt-cache", "llama-cpp", "prefill", "unevaluated"]
created_at: "2026-08-16T22:09:50.089Z"
updated_at: "2026-08-16T22:09:50.089Z"
---

# llama.cpp --cache-reuse is unevaluated for Otto's traffic

<!-- compiled_truth -->

`--cache-reuse N` is off by default in the llama.cpp builds Brain ships, and Brain passes no value, so every host runs with it disabled. It is a candidate lever for prefill cost on top of the prompt cache, but nothing has been measured: its benefit for Otto's traffic shape, its quality cost, and its interaction with Brain's YaRN context multiplier are all open. Do not enable it, expose it as a profile field, or cite a benefit for it until an A/B measurement exists.

## Timeline

- time: "2026-08-16T22:09:50.089Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-prompt-cache-sized-in-chats","brain-agent-compaction-budgets"]
- time: "2026-08-16T22:09:50.089Z"
  kind: "evidence"
  summary: "Verified on the host's installed runtime, cuda-12-4-managed-b10433, from `llama-server --help`:\n\n`\n--cache-reuse N   min chunk size to attempt reusing from the cache via KV shifting,\n                  requires prompt caching to be enabled (default: 0)\n                  (env: LLAMA_ARG_CACHE_REUSE)\n--context-shift, --no-context-shift   (default: disabled)\n`\n\n`packages/brain/src/runtime/args.ts` emits neither flag, so both sit at their upstream defaults. This is separate from `--cache-ram`, which Brain now sizes from `cachedChats` (see [[brain-prompt-cache-sized-in-chats]]): `--cache-ram` decides how many parked conversations survive in host RAM, while `--cache-reuse` decides whether a prompt that diverges from its cached copy can still reuse the tokens after the divergence.\n\nObservation, not hypothesis: Otto's steady-state agentic traffic is append-mostly. Each turn adds to the end of a conversation, which llama-server's longest-common-prefix slot selection already reuses in full (the host's own log showed `f_sim_best = 0.96+`). For that shape there is no obvious gap for `--cache-reuse` to close.\n\nHypothesis worth testing, not established: the case it targets is a prompt whose _middle_ changed, where the common prefix ends early but a long suffix is still valid. Otto produces exactly that on context compaction, which rewrites the middle of a conversation, and on any edit to a system addendum or tool definitions. If compaction currently forces a full re-prefill of everything after the rewrite point, this flag is the mechanism that would avoid it.\n\nOpen questions before it can be recommended:\n- Does compaction actually produce a reusable suffix, or does the rewrite shift every subsequent token's position enough that shifting buys nothing?\n- What is the quality cost? Reuse here is achieved by KV shifting - moving cached entries to new positions - and whether that is faithful for the architectures in Brain's catalog is unverified.\n- How does it interact with `contextMultiplier`? Brain supports YaRN rope scaling, and position shifting under a scaled rope is exactly where a correctness problem would hide. Untested.\n- Does it require `--context-shift`, which is also disabled by default in this build?\n\nSuggested method when revisited: an A/B on a compaction-heavy agentic run with `LLAMA_ARG_CACHE_REUSE` unset versus a value such as 256, measuring prefill tokens processed and time-to-first-token on the turns immediately after a compaction, plus a Brain Benchmark pass on both settings to catch quality regression. The env var makes this testable with no code change."
