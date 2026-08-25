# Onboarding - the setup wizard and the tutorial

A first-time user gets one guided, full-screen run-through that both **sets up** the host and
**teaches** what Otto is. It lives at `packages/app/src/screens/setup-wizard/`, route `app/setup.tsx`,
and is covered by `packages/app/e2e/first-time-wizard.spec.ts`.

Guiding principle: **configure the least amount needed for proper function; everything else is
tweaked and discovered later.** When the wizard finishes, the user lands on the normal open-project
screen with a working, themed agent roster and at least one team ready to go.

Related: [agent-profiles.md](agent-profiles.md) · [agent-teams.md](agent-teams.md) ·
[expo-router.md](expo-router.md) (route ownership and startup restore) ·
[sidebar-reveal](../projects/README.md#active-charters) for the unbuilt tutorial workspace step.

## The five steps

Order is locked - **Mode first**, because the chosen depth reframes every screen that follows.

1. **How do you want to use Otto?** - the interface-mode picker: **User** ("Chat with AI agents,
   organize projects, get things done - without the technical details") or **Developer** ("The full
   development environment: git, terminals, files, diffs"). Writes the device-local `interfaceMode`.
2. **Your providers** - what Otto auto-detected on this host, with status. Informational plus one
   choice: the **primary provider** the preset roster binds to, auto-selected when only one is found.
3. **Meet your agents** - a personality preset (Friendly, Professional, Agentic, Mixed) installing a
   themed, role-complete roster of 12, or "build your own" into the existing editor.
4. **Assemble your teams** - one or more team templates, each auto-filling its 6 members by role from
   the roster just created. Templates carry meaningful team prompts, which is where their real value
   lives.
5. **Done** - a summary card and the tutorial offer.

## Binding constraints

These are the ones that cost something to get wrong.

- **Least-setup.** The wizard configures exactly: interface mode (device), personality roster (host),
  teams plus the active team (host). Nothing else - no provider auth flows, no speech settings, no
  git hosting, no schedules. Every step past step 2 has a visible skip-or-keep-default path.
- **The wizard is a client of existing machinery, not a new subsystem.** Steps 3–4 write through the
  same daemon-config patch RPCs the settings editors use. Zero new protocol messages. If the host
  does not advertise `features.agentPersonalities` / `features.agentTeams`, the step shows the
  standard "Update the host to use this" card and is skippable - no fallback path.
- **Idempotent, additive, never destructive.** Each host-facing step loads the host's current state
  into its own UI _as if the wizard had installed it_, and the default action is **add**, not
  replace:
  - A **pristine** host (every roster entry has a `personality_builtin_*` id and deep-equals its
    `DEFAULT_AGENT_PERSONALITIES` entry) has its placeholder starter set **replaced** by the themed
    12 - the starter set is scaffolding, not user data.
  - **Any** host with user-touched or preset-installed personalities shows them as present and offers
    _add a preset's agents_ (append, dedup by stable id). A destructive replace-everything path
    exists but lives behind an explicit confirm and is never the default.
- **Device-scoped completion, host-scoped effects.** Completion is a device-local flag; roster and
  teams live on the host. A second device pairing to an already-configured host still gets steps 1–2
  and sees summaries for 3–4.
- **Developer-mode users lose nothing.** Picking Developer and skipping 3–5 yields an app
  byte-identical to not having a wizard at all.
- **Wizard state is not persisted.** Step state is local component state; killing the app mid-wizard
  restarts from step 1 (it is short). Only the final per-step commits write anywhere, and the
  completion flag is written on finish or skip - **never on entry**.

## Routing and completion

- **Setting:** `hasCompletedSetupWizard: boolean` (default `false`) in `AppSettings`, validated in the
  `pick*` chain like every other field. `interfaceMode` is a separate nullable field.
- **Route:** protected route `app/setup.tsx` under `<Stack.Protected>` in `RootStack`; screen
  implementation in `screens/setup-wizard/`, route policy in `src/navigation` (never `src/app`) - per
  [expo-router.md](expo-router.md). A top-level route needs **two** registrations: `RootStack` and
  the `shouldShowAppChrome` allow-list.
- **Resolver:** `resolveStartupRoute` in `navigation/host-runtime-bootstrap.ts` routes to `/setup`
  before `/open-project` when a host is ready and the flag is false. Sequencing is **welcome/pairing
  → wizard → open-project**: a device with no host has nothing to configure.
- **Existing devices never see it.** Devices with persisted app settings but no flag get
  `hasCompletedSetupWizard: true` backfilled on settings load - the presence of any persisted
  settings implies not-a-fresh-install. Nobody wakes up inside a wizard.
- **Re-run:** Settings → About → **"Reset First Time Wizard"** navigates to `/setup`. The completion
  flag stays `true`; because the wizard is idempotent, re-running it is a genuine _generate more_
  affordance rather than a wipe. The label names re-entering the wizard, not clearing data - the
  subtext says so explicitly.

## Brand bookends

The wizard opens and closes on animated Otto brand art; the middle steps are deliberately plain UI,
**so setup never feels gimmicky**. The Welcome cover is the first thing a user sees on their first
host connection: the glyph animates in, winks, the plasma ring orbits, then "Start" slides the brand
away and the interactive steps slide in. The Done step slides the brand back as a mirror of the
cover, carries the summary, and hosts the tutorial yes/no.

## The tutorial

The in-app spotlight tutorial (`tutorial/`) is offered at step 5 and has its **own** one-time flag
(`hasCompletedTutorial`), so it never re-fires uninvited regardless of the wizard's state.

> **The spotlight is currently disabled.** Re-enabling it is tracked in the projects ledger; the
> tutorial's unbuilt create-workspace step has its plan in
> [`projects/sidebar-reveal/`](../projects/sidebar-reveal/sidebar-reveal.md).

## Known tail

The wizard shipped English-only. i18n for its strings is tracked in the
[projects ledger](../projects/README.md#i18n).
