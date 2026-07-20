# A "waiting" voice-cue moment

Today a turn finishing always fires the `done` cue. When the parent turn is over
but **sub-agents are still running**, the agent isn't done — it's waiting. Add a
fourth cue moment for that case.

Related: [docs/visualizer.md](../../docs/visualizer.md),
[docs/agent-lifecycle.md](../../docs/agent-lifecycle.md),
[projects/observed-subagents](../observed-subagents/observed-subagents.md).

## The plumbing (mechanical)

The moment vocabulary is protocol-owned, so everything keys off one constant:

| Layer     | Where                                                               | Change                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol  | `packages/protocol/src/messages.ts`                                 | add `"waiting"` to `CUE_MOMENTS`; add a `waiting` group to `AgentPersonalityVoiceCuesSchema`. `moment: z.enum(CUE_MOMENTS)` follows for free                                    |
| Generator | `packages/server/src/server/agent/voice-cue-generator.ts`           | `VoiceCueLines`, `VOICE_CUE_SCHEMA`, a `MOMENT_SPECS.waiting` entry (label/meaning/**overused** ban list), `buildCombinedPrompt`, `emptyLines()`                                |
| Editor    | `packages/app/src/screens/settings/agent-personalities-section.tsx` | `DraftVoiceCues`, `CUE_KIND_HINTS`/`CUE_KIND_LABELS`, `draftVoiceCuesFrom`/`draftVoiceCuesToPersistable`, `newDraft()`. The progress bar is already `CUE_MOMENTS.length`-driven |
| Runtime   | `packages/app/src/visualizer/use-visualizer-voice-cues.ts`          | a dedupe flag on `AgentCueState`, plus the trigger below                                                                                                                        |

Back-compat is free: `voiceCues` is optional/passthrough, so existing
personalities simply have no `waiting` lines and stay silent for that moment.

Tests to update: `voice-cue-generator.test.ts`, `e2e/helpers/personalities.ts`,
`demo/staging/cast.ts`.

## The actual work

`processAgent` only sees `Agent["status"]`, and there is **no "waiting" status
today**. The real task is deciding what feeds it:

- The condition is "parent turn finalized AND ≥1 observed sub-agent still
  running" — the observed-subagents track already knows the second half.
- Needs a rule for how `waiting` interacts with the one-cue-per-tick early
  returns, and what happens when the last sub-agent finishes (does `done` fire
  then? Almost certainly yes — `waiting` should be a deferral of `done`, not a
  replacement).

No vendor build needed; voice cues are entirely host-side.
