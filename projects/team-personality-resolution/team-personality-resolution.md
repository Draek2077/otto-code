# Team personality resolution: the remaining latches

New chats under an active team still land on a stale saved personality or a
bare base model. One cause — the biggest — was fixed on 2026-07-20; this
charter covers what's left.

Related: [docs/agent-teams.md](../../docs/agent-teams.md),
[docs/agent-personalities.md](../../docs/agent-personalities.md).

## Already fixed (2026-07-20)

The picker's `selectedPersonalityId` is the synthetic `__team-chatter__`
sentinel whenever the "Team's Chatter" slot is picked. That id was passed
verbatim to `createAgent`; the daemon's roster lookup missed
(`session.ts` `applyPersonalityIdentityToConfig`, "personality id not found in
roster; spawning without personality identity") and spawned a **bare agent** —
no personality prompt, no team prompt, no spinner, no name, on whatever model
the device happened to remember. That is exactly the reported symptom, and it
explains why it worked for a user who had explicitly picked a personality and
failed for users who relied on the team default.

Fix: `RolePersonality.spawnPersonalityId` resolves the slot to the real member
id, and all three spawn sites read it through `resolveSpawnPersonalityId`
(`workspace-tab-core.ts`, `new-workspace-screen.tsx`,
`workspace-setup-dialog.tsx`).

## Remaining defects

### 1. The "fallback" default latches on a transient unavailable

`useFormRolePersonality`'s one-shot default effect
(`packages/app/src/provider-selection/role-model-personality.ts`) gates only on
`config` being present and `entries` being non-empty. The daemon's first
snapshot for a cwd has every provider `status: "loading"`, and
`checkPersonalityAvailability` rejects anything not `"ready"`. So on the first
render where entries exist but providers are still warming, `teamEntry.values`
is null and `defaultAppliedRef.current` is set to `true` **permanently** — it
never retries when the provider goes ready. Under a team, remembered
personalities are also suppressed, so the draft ends with **no personality at
all** and whatever model resolution step A produced.

Fix direction: make the settle conditional on the snapshot actually being
settled (no provider still `"loading"`), or drop `defaultAppliedRef` in favour
of "apply once the team entry first resolves, unless the user touched the
picker".

### 2. Remembered personality has no un-latch

`selectedPersonalityId` is `useState` in `use-personality-selection.ts`.
`preselectRemembered` only prevents _new_ preselects — flipping it to `false`
later never clears an already-set id. Any single render where `teamSlotLive` is
false while roster/entries/prefs are warm latches the stale personality forever,
and the default effect then bails out. This is reachable because
`teamSlotLive`'s two inputs load from different sources (`config` via
react-query keyed on a `serverId` that is itself null until auto-select, and
`features.agentTeams` via the session store), so a warm query cache can produce
exactly that render.

Fix direction: actively clear a latched remembered id when `preselectRemembered`
transitions to false.

### 3. Fork / "new tab from this agent" carries no personality

`WorkspaceDraftTabSetup` carries provider/model/mode/effort but **no
personality**. Those become `initialValues`, which outrank device prefs, so the
tab opens on a raw inherited model and depends entirely on the team default
(defect 1) to gain an identity.

### 4. Re-resolution can revert the team's values

`REQUEST_RESOLUTION` resets all `userModified` flags on any
`isVisible`/`resolutionIntentKey` change, then re-derives provider/model from
`initialValues`/device prefs. If that fires after the team applied its values,
the model silently reverts while the picker still shows "Team's Chatter" —
trigger and spawned model disagree.

## Testing

This area has no coverage for the load-order cases, which is why it regressed
quietly. Any fix should come with tests that simulate a provider snapshot
arriving `loading` first and `ready` second.
