---
id: "follow-prompt-suggestions-is-not-a-mode-of-auto-mode"
kind: "decision"
title: "Follow prompt suggestions is not a level of Auto mode"
status: "proposed"
tags: ["app","composer","settings","autonomy","token-economy"]
created_at: "2026-08-21T03:20:27.383Z"
updated_at: "2026-08-21T03:20:27.383Z"
---
# Follow prompt suggestions is not a level of Auto mode

<!-- compiled_truth -->

"Follow prompt suggestions" is an independent, device-local, off-by-default app setting that accepts an already-generated next-prompt suggestion on the user's behalf. It is deliberately not a level, variant, or special case of Auto mode, and the two share no code.

The boundary is a difference in what is being decided. Auto mode governs how an agent decides to act **inside** a turn: which tools it may run without asking, and how permission prompts resolve. Follow prompt suggestions governs one thing **between** turns: who accepts the ghost-text suggestion the agent already produced, the user pressing Tab or the app. Everything the agent then does once that prompt is sent is still governed by Auto mode, unchanged. Folding the toggle into Auto mode would have collapsed two different questions into one dial and made "off" ambiguous.

Concrete consequences that hold the boundary:

- Its own setting, `followPromptSuggestions` in `packages/app/src/hooks/use-settings/otto-settings.ts`, default `false`, with its own Settings row and its own copy that names Auto mode only to say it is separate.
- Nothing in `packages/app/src/composer/follow-suggestion/` reads or writes a permission mode, and nothing in the permission-mode path reads this flag.
- The row is only rendered while `promptSuggestionsEnabled` is on, because a dependent toggle that cannot act reads as broken rather than unavailable.
- Off is inert: no chain state, no band, no store writes. Turning the setting off also clears any chain state so re-enabling starts from zero.

Two properties the feature must keep, because they are what stops autonomous self-prompting from feeling out of control:

- **A hard bound.** `FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE = 3` consecutive followed suggestions per chat. Each followed suggestion produces another suggestion, so without a bound a chat prompts itself forever. The count resets only when the user sends a message of their own, so a person in the conversation is never rate-limited by it, and an abandoned one stops after three.
- **Visibility.** An auto-accepted prompt lands in the transcript looking exactly like a typed one. A purple `FlyoutBand` above the message box states that Otto is following the agent's suggestions, counts them against the bound, and carries a Stop that ends the chain for that chat without changing the setting.

## Timeline

- time: "2026-08-21T03:20:27.383Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["august-20-ux-feedback-sweep"]
- time: "2026-08-21T03:20:27.383Z"
  kind: "evidence"
  summary: "Surface identified by reading the code rather than guessing. The repo has two distinct \"suggestion\" surfaces and they are not interchangeable:\n\n- **Next-prompt suggestions (the one the user meant).** The daemon emits an `agent_stream` event of type `prompt_suggestion`; `packages/app/src/contexts/session-context.tsx:842` stores it per agent in `session-store`'s `agentPromptSuggestions`. The composer renders it as ghost text in the message box placeholder (`packages/app/src/composer/index.tsx`, the `placeholder` prop) and `acceptPromptSuggestion` accepts it on Tab, filling the box without sending. Gated by the `promptSuggestionsEnabled` app setting and the host's `promptSuggestions` capability.\n- **Suggested tasks (not the one).** `packages/app/src/suggested-tasks/` carries `SuggestedTaskInfo` rows of `taskId` / `title` / `tldr` / `cwd` produced by the `spawn_task` tool, which the user starts as a **separate agent in a new chat**, asynchronously.\n\nThe user's phrasing decides it: \"a suggestion for the next prompt\" and \"follow your own suggestion\" describe the agent predicting what the user should say next and then saying it itself. That is literally the ghost-text `prompt_suggestion`. A suggested task is a new unit of work in a new chat, not a next prompt, and auto-starting those would be a different feature (\"auto-spawn suggested tasks\").\n\nShipped in this change:\n\n- `packages/app/src/composer/follow-suggestion/decide.ts` - the whole rule as one pure function, `decideFollowPromptSuggestion`, returning `{action:\"send\"}` or `{action:\"skip\", reason}` over nine ordered guards: `off`, `suggestions-off`, `no-suggestion`, `stopped`, `draft-present`, `attachments-present`, `queue-present`, `agent-busy`, `cannot-submit`, `limit-reached`. Also exports the bound and `resolveFollowChainPhase` so the band never re-derives the rule.\n- `chain-store.ts` - per-chat `{sentCount, isStopped}`, keyed `serverId:agentId`, client-local and deliberately outside `session-store` so deleting the feature is deleting the directory.\n- `use-follow-prompt-suggestion.ts` - the driver. Depends on the guard values, not just the suggestion text, because a suggestion arrives at the tail of a turn while `isAgentRunning` may still be true for a beat; a `handledRef` keeps that from firing twice for one suggestion.\n- `setting.ts` - `select`-based read off the settings query cache (`APP_SETTINGS_QUERY_KEY`, `pushEvent: \"local:app-settings-write\"`), mirroring `use-auto-clear-completed-background-tasks.ts`, so the driver does not re-run on unrelated settings writes. Defaults to `false` while loading: the feature never sends on a guess.\n- `track.tsx` - the purple band, mounted in `packages/app/src/panels/agent-panel.tsx` at the new `COMPOSER_TRACK_LAYERS.followSuggestion` slot (3; `subagents`, `backgroundTasks`, `composer` renumbered to 4/5/6, and every consumer reads the constant).\n- `packages/app/src/composer/index.tsx` - `sendMessageWithContent` gained an `origin: \"user\" | \"follow-suggestion\"` parameter defaulting to `\"user\"`. Only a user send calls `resetChain`, which is what stops a self-prompting chat from renewing its own budget. The reset sits outside the text-only block so an attachment-only send counts as participation.\n\nGuards worth naming: the draft guard means the feature never sends over or destroys typed text, and the attachment and queue guards mean it never silently ships something the user staged deliberately.\n\nCoverage: `decide.test.ts` (16 cases: every skip reason, the trimmed-send path, the bound walked over a 20-turn self-prompting chat, a caller-supplied bound, and the re-arm after reset) and `chain-store.test.ts` (8 cases: per-chat isolation, Stop scoped to one chat, reset clearing both fields, and a 25-turn unattended chat bounded at 3). Both green. App typecheck reports no errors in any file this change touched; the errors present in `packages/app` at the time belong to another session's in-flight editor and diff work in the same shared checkout.\n\nAlso folded into `docs/token-economy.md` under multiplier 4, because this multiplies whole turns rather than adding a call to one."
