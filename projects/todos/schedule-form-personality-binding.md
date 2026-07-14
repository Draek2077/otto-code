# TODO: Persist a personality binding from the client schedule form

**From:** agent-personalities, Step 5b-client (the one intentionally-open item; the rest of the
project shipped and is folded into [docs/agent-personalities.md](../../docs/agent-personalities.md)).
**Size:** small–medium. **Blocking sub-item:** one product decision (below) — settle it first.

## Goal

Let a user bind a **personality** to a schedule from the schedule form UI, so scheduled runs spawn
with that personality (identity + prompt + brain), re-resolved at each run against the live roster.

## Current state (verified)

- **Server side is fully shipped.** A schedule config already carries an optional `personality`
  field, and the run path resolves it per run:
  - `packages/server/src/server/schedule/service.ts` — `patch.personality` is read/stored
    (`config.personality`, ~L97–103); the run path takes `providerSnapshotManager` +
    `readAgentPersonalities` and resolves the bound personality at run time (~L243–267, L960). A run
    under the active team carries that team's frame iff the bound personality is a member, else runs
    teamless (never a hard-fail).
  - MCP `create_schedule` / `update_schedule` already accept the personality, so the capability is
    reachable today without the form.
- **Client side is missing.** The app schedule form has **no** personality field:
  - `packages/app/src/schedules/schedule-form-model.ts` and `use-schedule-form-model.ts` — no
    `personality` in the model.
  - `packages/app/src/components/schedules/schedule-form-sheet.tsx` — no personality picker rendered.
  - `packages/app/src/schedules/use-schedule-form-provider-snapshot.ts` — the form already resolves a
    provider/model snapshot; the personality picker would sit alongside it.

## The product decision (settle before building)

The Step-4 create-flow personality picker today is **ephemeral auto-fill** (picking a personality
just fills provider/model/effort into the draft; the identity isn't persisted). Binding it on a
_schedule_ changes the semantics to a **persisted, re-resolve-per-run binding** — the schedule stores
the personality id and re-resolves it every run (so roster edits between runs take effect, and a
deleted/unavailable personality surfaces as unavailable at run time, matching the resolution engine's
contract). Confirm we want that persisted-binding semantic on schedules (recommended — it's what the
server already implements) rather than a one-time fill at creation.

## Task

1. Add an optional `personality` (personality **id**) to the client schedule form model
   (`schedule-form-model.ts`) and thread it through `use-schedule-form-model.ts` and the
   create/update mutation (`hooks/use-schedule-mutations.ts`) into the schedule config patch.
2. Render a personality picker in `schedule-form-sheet.tsx`, reusing the existing create-form
   personality picker component + the availability/resolution helpers from
   `protocol/agent-personalities.ts` (so an unavailable personality shows as such). Match-gate the
   remembered selection the same way the create form does via
   `use-form-preferences.ts` `lastPersonalityByRole` if you want reopen-preselect parity.
3. On load of an existing schedule, hydrate the picker from the stored `config.personality`.
4. Gate the picker on `features.agentPersonalities` (show nothing / raw provider-model when absent —
   no fallback path, per house rules).

## Verify

Create a schedule with a bound personality → confirm the stored schedule config has `personality`
set; let it run (or trigger it) and confirm the spawned agent carries that personality's identity;
delete the personality and confirm the next run reports it unavailable rather than silently drifting.

## Compat

`personality` is already an optional leaf on the schedule config — additive, no protocol break. Keep
the client capability-gated on `features.agentPersonalities`.
