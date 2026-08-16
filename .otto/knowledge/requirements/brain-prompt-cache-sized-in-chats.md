---
id: "brain-prompt-cache-sized-in-chats"
kind: "requirement"
title: "Brain sizes the llama.cpp prompt cache in chats, not megabytes"
status: "proposed"
tags: ["brain", "kv-cache", "prompt-cache", "profile", "calibration", "memory"]
created_at: "2026-08-16T21:58:33.975Z"
updated_at: "2026-08-16T23:35:00.000Z"
---

# Brain sizes the llama.cpp prompt cache in chats, not megabytes

<!-- compiled_truth -->

A model profile stores `cachedChats` (edited under the label **Cached KVs**), a count of chats whose KV state llama-server may park in host RAM when they lose a GPU slot. Brain derives `--cache-ram` from it at the launch boundary as `cachedChats x kvBytesPerToken x (contextSize / parallelSlots)`. A raw MiB setting is not offered: the size of one parked chat depends on the model's measured KV cost and on the per-slot context, so the same megabyte figure means a different number of chats on every profile.

The RAM estimate is shown for **every** value of the field, at all times the field is available - not only once a count above 0 has been priced. It is the single `cachedChats` warning from `profileWarnings` (the one source, in `config/profile-edit.ts`), rendered in both the app editor and the TUI: a count above 0 reads `4.8G each becomes 28.8G of 61.6G.`; the Default of 0 reads `llama.cpp's own limit applies: about 8.0G of 61.6G.`, because 0 emits no flag and the engine then parks up to its own fixed 8192 MiB `--cache-ram` default (`ENGINE_DEFAULT_CACHE_RAM_BYTES`) in host RAM - model-independent, and not the same as caching nothing. The estimate's colour is its severity: muted below half the installed RAM, **yellow at ≥50%** (`warn`), **red once it would use at least all of the system RAM** (`error`); the app maps `info`/`warn`/`error` to `hintText`/`warnText`/`errorText`.

A count above 0 is priced only from a measurement; an unmeasured model with a count above 0 still emits no flag, because the theoretical KV cost overestimates by multiples and a budget derived from it would reserve several times the RAM actually needed, so the warning asks for a calibration instead. `cachedChats` is not a calibration input - it spends host RAM, never VRAM.

## Timeline

- time: "2026-08-16T23:35:00.000Z"
  kind: "note"
  summary: "Compiled truth updated to the shipped behaviour: the field is labelled Cached KVs; the RAM estimate is shown for every value of the field, including the Default of 0 (the engine's own 8192 MiB cache-ram default, model-independent); the prose is shortened to '<per> each becomes <total> of <installed>.' / 'llama.cpp's own limit applies: about 8.0G of <installed>.'; and the estimate's severity is coloured muted below half the installed RAM, yellow at >=50% (warn), red once it would use at least all of it (error). The estimate is the single cachedChats ProfileWarning from config/profile-edit.ts, rendered by both the app editor and the TUI."
- time: "2026-08-16T21:58:33.975Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-all-model-operations-share-scheduler","brain-model-settings-preserve-reasoning","brain-extended-context-multiplier"]
- time: "2026-08-16T21:58:33.975Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-16: a server with 64 GB of mostly idle system RAM should be usable to absorb KV cache thrashing, and the control should be expressed as a count of caches with the estimated size shown, not as a size the user has to convert.\n\nMeasured on the host's installed runtime (cuda-12-4-managed-b10433): `-cram, --cache-ram N` sets the prompt cache in MiB, default 8192, -1 = no limit, 0 = disable; `--cache-idle-slots` (default enabled, requires cache-ram) is what parks an idle slot's state. Brain passed no flag, so every host ran on the 8192 default. Against the host's own stored calibration for unsloth/Qwen3.8-27B (kvBytesPerToken = 40,142 measured 2026-08-15, versus 141,440 theoretical - a 3.5x overestimate), one chat at 262144 context over 2 slots is ~4.9 GiB, so the 8 GiB default cannot hold two full conversations. That matches the observed thrashing in the three-chat run, which evicted ~2.4 GiB entries on nearly every request; 2.4 GiB is about half a slot, consistent with mid-length conversations.\n\nThe count is a floor, not a cap: it assumes every chat fills its whole window, and real conversations rarely do, so more usually fit. Implemented in packages/brain/src/vram.ts (kvBytesPerToken extracted from budget() so the measured-or-theoretical choice has one definition and callers spending real memory can branch on its source; promptCacheSize), runtime/args.ts, service/supervisor.ts, config/schema.ts, config/profile-edit.ts, tui/app.ts, protocol/src/messages.ts and the descriptor-driven app editor. Covered by args and profile-edit tests; 1000 brain and protocol tests, all workspace typechecks, lint and format pass."
