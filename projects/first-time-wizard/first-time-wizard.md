# First-time wizard — charter

Status: **PLANNED** (design drafted 2026-07-12, not yet locked).

Otto currently drops a new user onto the Welcome/pairing screen and then straight into the open-project screen — everything else (providers, personalities, teams, display depth) is discovered piecemeal in settings. The **first-time wizard** replaces that cold start with one guided, full-screen run-through that both **sets up** the host and **teaches** what Otto is, in a single pass. The guiding principle: **configure the least amount needed for proper function; everything else is tweaked and discovered later.** When the wizard finishes, the user lands on the normal home (open-project) screen with a working, themed agent roster and at least one team ready to go.

Two sibling charters feed this one:

- **Interface modes** — absorbed into this project. The former `projects/interface-modes/` charter now lives at [interface-modes.md](interface-modes.md) as a sub-plan of this project; its first-run picker **is wizard step 1** (Mode is chosen first), and its surface-gating work is a phase of this project's build sequence. Read it for the binding constraints (lens-not-lock, one gate, developer-mode-identical) — those all still hold.
- **Agent Teams** ([projects/agent-teams/agent-teams.md](../agent-teams/agent-teams.md)) — a hard dependency. The wizard's step 4 creates and activates teams, so agent-teams build steps 1–2 (schema + persistence + prompt composition) must ship first. The teams editor card and main-window switcher (its steps 3–5) are not wizard-blocking but should land in the same release so wizard-created teams are manageable afterwards.

North-star fit ([CLAUDE.md](../../CLAUDE.md)): the wizard is provider-agnostic from day one. Preset personalities resolve against whatever providers the host actually detected — an LM Studio-only host gets the same themed roster as a Claude host, bound to its own models.

---

## The UX north star

Full screen, no app chrome — no sidebar, no tabs, no settings gear. The wizard is a protected route rendered as a plain screen (the `WelcomeScreen` shape), with a step indicator, Back, and a persistent **"Skip setup"** escape hatch. It must feel great on a phone (compact form factor is the primary Otto surface) and on desktop. When the wizard completes — or is skipped — the user goes to the open-project screen and never sees the wizard again on that device.

**Brand bookends.** The wizard opens and closes on the animated Otto brand — the same art language as the Play/marketing **feature graphic** ([packages/app/demo/assets/feature-graphic.html](../../packages/app/demo/assets/feature-graphic.html)), rebuilt as a live screen (dark field, dual indigo+teal glow, faint masked grid, the Otto glyph, and the real orbiting `BlobLoader`). The **Welcome** cover is the very first thing a user sees on their first host connection: the Otto glyph animates in, **winks** (crossfade to `OttoLogoWink`), the plasma ring orbits, then **"Start"** slides the brand away and the plain interactive steps (Mode → Providers → Agents → Teams) slide in. The final **Done** step slides the brand art back in as a mirror of the cover, carries the summary, and hosts the tutorial yes/no before the wizard closes. The middle steps are deliberately plain UI — the motion and art live only in the two bookends, so setup never feels gimmicky. Full spec in [Brand art & motion](#brand-art--motion) below.

The five steps (order locked 2026-07-12 — **Mode first**, because the chosen depth reframes every screen that follows):

1. **How do you want to use Otto?** — the Interface mode picker: **User** ("Chat with AI agents, organize projects, get things done — without the technical details") or **Developer** ("The full development environment: git, terminals, files, diffs"). One tap. Writes the device-local `interfaceMode` setting per the [interface-modes sub-plan](interface-modes.md). It comes first so the rest of the wizard — and the app it lands in — already renders at the chosen depth.
2. **Your providers** — show what Otto auto-detected on this host (Claude Code, Codex, Copilot, OpenCode, Pi, plus any configured custom/openai-compat endpoints), with status. Informational + one choice: the **primary provider** the preset roster will bind to (auto-selected when only one is detected). Footnote: more providers can be added later in Settings.
3. **Meet your agents** — pick a personality preset: **Friendly**, **Professional**, **Agentic**, or **Mixed** — or **build your own**. A preset installs a themed, role-complete roster of **12 personalities** (the starter-set structure, doubled — two per archetype slot). The theming is strong and obvious: names, prompts, spinner colors, and voices all match the theme. "Build your own" drops into the existing personality editor flow instead. **Idempotent (see constraint 3):** on a host that already has personalities, this step loads them into its own UI as already-installed and lets you _add_ a preset's agents alongside them — it never wipes what's there.
4. **Assemble your teams** — choose one or more **team templates** (Development crew, Creative studio, Research panel, Automation & ops), each of which auto-fills its 6 members by role from the roster just created — or build a team by hand (pick any 6 personalities). Pick which team starts **active** (or none). Templates carry meaningful team prompts, which is where their real value lives (orchestration framing). Existing teams load in as-is, same idempotent posture.
5. **Done — welcome** — a short summary card (mode, roster, teams) and a warm welcome → **"Start the tour"** launches the in-app spotlight tutorial (the `tutorial/` subsystem), or **"Skip for now"** goes straight home. Either way the wizard is marked complete; the tour has its own one-time flag (`hasCompletedTutorial`) so it, too, never re-fires uninvited.

Skipping at any point is safe: the daemon has already seeded the classic 6-personality starter set on first run, so a skipped wizard still yields today's fully working app. Skip = keep whatever exists, mark the wizard complete, go home.

Re-entry: once a host is set up the wizard never fires on its own again, but it can be **re-opened deliberately** from **Settings → About → "Reset First Time Wizard"**, which routes back into the wizard as if from a fresh start. Because the wizard is idempotent it re-loads the current mode, roster, and teams into its own UI — so re-running it is a safe way to _add_ more personalities or spin up another team, not a reset that destroys anything.

---

## Binding constraints

1. **Least-setup principle.** The wizard configures exactly: interface mode (device), personality roster (host), teams + active team (host). Nothing else — no provider auth flows, no speech settings, no git hosting, no schedules. Every step past step 2 has a visible skip/keep-default path.
2. **The wizard is a client of existing machinery, not a new subsystem.** Steps 3–4 write through the same daemon-config patch RPCs the settings editors use (`useDaemonConfig` round-trip, hot reload via `status:daemon_config_changed`). Zero new protocol messages are expected; the only new wire surface comes from the agent-teams dependency, which owns it. If the host doesn't advertise `features.agentPersonalities` / `features.agentTeams`, the corresponding step shows the standard "Update the host to use this" card and is skippable — no fallback path (house rule).
3. **Idempotent, additive, never destructive.** Re-running the wizard is safe by construction: each host-facing step **loads the host's current state into its own UI as if the wizard had installed it** (existing personalities shown as installed, existing teams shown as built), and the default action is **add**, not replace. Concretely:
   - Fresh/pristine host (roster is exactly the untouched builtin starter set — every entry has a `personality_builtin_*` id and deep-equals its `DEFAULT_AGENT_PERSONALITIES` entry): applying a preset **replaces** the placeholder starter set with the themed 12 (the starter set is scaffolding, not user data).
   - Any host with user-touched or preset-installed personalities: the step shows them as already present and offers **Add a preset's agents** (append, dedup by stable id) or **build your own** — the roster is only ever grown. A destructive "replace everything" path exists but lives behind an explicit confirm and is never the default.
   - Same posture for step 4: existing teams load in; templates and custom teams are appended; the active-team choice defaults to whatever is active today.
     This makes the About → "Reset First Time Wizard" re-entry a genuine _generate-more_ affordance, not a wipe. ("Reset" names re-entering the wizard, not clearing data.)
4. **Device-scoped completion, host-scoped effects.** Completion is a device-local flag; roster/teams live on the host. A second device pairing to an already-configured host still gets steps 1–2 (they're device/informational) but sees the constraint-3 summaries for 3–4.
5. **Developer-mode users lose nothing.** A user who picks Developer in step 2 and skips 3–5 ends up in an app byte-identical to today (constraint carried over from the interface-modes sub-plan).
6. **All wizard state is resumable-safe but not persisted.** The wizard keeps step state in local component state; killing the app mid-wizard restarts it from step 1 (it's short). Only the final per-step commits write anywhere. The completion flag is written on finish/skip, never on entry.

---

## Routing & completion

- **Setting:** `hasCompletedSetupWizard: boolean` (default `false`) in `AppSettings` ([storage.ts](../../packages/app/src/hooks/use-settings/storage.ts)) — the repo's first persisted onboarding flag. Validated in the `pick*` chain like every other field. `interfaceMode` is a _separate_ nullable field per the sub-plan (it doubles as the settings-row value); the wizard writes both.
- **Route:** new protected route `app/setup.tsx` registered under `<Stack.Protected>` in `RootStack` (`app/_layout.tsx`), rendered with `ThemedStack` conventions; screen implementation lives in `screens/setup-wizard/`, shared route policy in `src/navigation` (never `src/app`) — per [docs/expo-router.md](../../docs/expo-router.md).
- **Resolver:** extend the pure `resolveStartupRoute` in `navigation/host-runtime-bootstrap.ts`: when a host is ready and `hasCompletedSetupWizard === false`, route to `/setup` before `/open-project`. Pure-function tests alongside the existing resolver tests. Sequencing is **welcome/pairing → wizard → open-project**: a device with no host has nothing to configure (steps 1, 3, 4 are host-facing), so the wizard fires on first successful host connection. On web/desktop with the built-in daemon this makes the wizard the first real screen after the splash.
- **Existing devices never see it.** Migration: devices with persisted app settings but no flag get `hasCompletedSetupWizard: true` backfilled on settings load (presence of any persisted settings ⇒ not a fresh install). A genuinely fresh install gets `false`. This mirrors the interface-modes `null → developer` posture: nobody wakes up inside a wizard.
- **Re-run:** **Settings → About** gets a **"Reset First Time Wizard"** row that navigates to `/setup` (the completion flag stays `true`; finishing again just re-commits choices additively per constraint 3). About is the deliberate home for it — it sits with the app-identity/version block, reads as "start over from the intro," and keeps the frequently-used General pane uncluttered. Cheap, and makes the wizard testable without clearing storage. The label says "Reset First Time Wizard"; the subtext clarifies it re-opens the guided setup and never deletes agents or teams.

## Step specs

### Step 1 — Interface mode

Two large cards (User / Developer), plain copy, footnote naming where to change it later (Settings → General). Writes `persistAppSettings({ interfaceMode })` immediately on selection so the rest of the wizard — and the app it lands in — already renders at the chosen depth. Everything else about the mode — the hook, the settings row, the surface inventory, the gating rules — is specified in [interface-modes.md](interface-modes.md); this step replaces that sub-plan's standalone `choose-interface` route. Comes first deliberately: depth is the frame everything after it is read through.

### Step 2 — Your providers

Read-only list built from the existing providers snapshot (`use-providers-snapshot.ts` / `get_providers_snapshot`): provider icon, label, detected status (available / not installed / error), model count. No auth flows, no enable toggles — detection is the daemon's job and already automatic. One interactive element: the **primary provider** selector (radio on the available rows), defaulted to the first available by a fixed preference order (`claude` → `codex` → `copilot` → `opencode` → `pi` → custom endpoints). The choice feeds step 3's brain resolution and is not persisted anywhere else. Zero available providers ⇒ explanatory copy + "you can still continue" (presets then bind the classic Claude defaults, which sit out-of-commission until a provider appears — exactly the shipped starter-set behavior on a Claude-less host).

### Step 3 — Meet your agents (personality presets)

Four preset cards + "Build your own". Each preset card shows its vibe: theme name, a one-line pitch, and a strip of the roster's spinner-color dots + 2–3 sample names, so the theming is legible before committing.

**The slot structure** — the shipped starter set, doubled. Every preset defines the same 12 slots (6 archetypes × 2 variants), so role coverage (all 8 roles, ×2) and brain shape are identical across themes; only identity changes:

| Archetype | Roles                 | Brain tier                      | Variant A                   | Variant B                             |
| --------- | --------------------- | ------------------------------- | --------------------------- | ------------------------------------- |
| Lead      | orchestrator, chatter | deep · high · auto              | the deliberate planner-lead | the fast, decisive dispatcher         |
| Advisor   | advisor               | deep · xhigh · plan             | the big-picture strategist  | the pragmatist ("what breaks first?") |
| Judger    | judger                | standard · high · plan          | the correctness reviewer    | the security & edge-case skeptic      |
| Artificer | artificer             | standard · medium · acceptEdits | the UI / visual maker       | the data-viz & document maker         |
| Scribe    | writer, scheduler     | fast · low · auto               | the commit/PR scribe        | the docs & summary writer             |
| Builder   | chatter, coder        | standard · medium · default     | the methodical implementer  | the refactorer & fixer                |

**The three themes** — names locked here, prompts/colors/voices authored at build time to match, and they must match _strongly_ (a Professional judger writes like a staff engineer's review; an Agentic scribe reads like mission-control telemetry):

| Slot        | Friendly (warm, encouraging, human) | Professional (crisp, consulting-grade) | Agentic (mission-control, machine-toned) |
| ----------- | ----------------------------------- | -------------------------------------- | ---------------------------------------- |
| Lead A/B    | Sunny / Scout                       | Sterling / Mercer                      | Nexus / Vector                           |
| Advisor A/B | Hazel / Otis                        | Winslow / Ellis                        | Axiom / Oracle                           |
| Judger A/B  | Ruby / Piper                        | Vance / Harlow                         | Sentinel / Cipher                        |
| Artificer   | Poppy / Milo                        | Quinn / Avery                          | Prism / Forge                            |
| Scribe A/B  | Jot / Daisy                         | Reed / Marlow                          | Relay / Ledger                           |
| Builder A/B | Finn / Bea                          | Blake / Rowe                           | Circuit / Flux                           |

Color direction: Friendly = warm ambers/corals/spring greens; Professional = navy/slate/steel/burgundy, muted; Agentic = neon cyan/magenta/acid green. Voices are Kokoro v1.0 names (soft binding, as the starter set), cast per character. Ids are stable `personality_preset_<theme>_<slug>` so re-runs dedupe and future restore machinery can extend to presets.

**Mixed** rolls each of the 12 slot-variants from a uniformly random theme at selection time — full role coverage and brain structure are guaranteed by construction; only identity is randomized. (Roll happens in the app at tap time; show the resulting roster before committing, with a re-roll button — cheap delight.)

**Brain resolution (tiers, not hardcoded models).** Presets store a **tier** (`deep` / `standard` / `fast`), not a model id. At commit, the wizard resolves each tier against the step-1 primary provider via a per-provider tier table in the preset module (claude: opus/sonnet/haiku-class; codex/copilot/opencode/pi: their equivalents, authored at build time against `provider-manifest.ts`), falling back to the provider's default model when a tier has no mapping, and to the classic Claude defaults when no provider is available. Effort stays canonical (`EffortLevel`, resolved at spawn as today). Mode ids are validated against the provider's live modes and dropped when absent (the personality then inherits the provider default — shipped behavior).

**Commit semantics.** Pristine roster (constraint 3) ⇒ one config patch replacing `agentPersonalities` with the 12 preset entries. Non-pristine ⇒ summary card with keep/replace. "Build your own" ⇒ mounts the existing roster editor experience (the `PersonalityEditModal` flow from `agent-personalities-section.tsx`, reused not forked) seeded with the current roster; continuing to step 4 uses whatever the user built.

### Step 4 — Assemble your teams

Requires `features.agentTeams`. Template cards, multi-select — each selected template creates one team of **6 members**, filled by role from the step-3 roster:

| Template             | Members (role × count)                                  | Team prompt direction                                                                     |
| -------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Development crew** | lead ×1, advisor ×1, coder ×2, judger ×1, writer ×1     | Build–verify–ship loop: plan first, implement in small verified steps, review before done |
| **Creative studio**  | lead ×1, artificer ×2, writer ×1, advisor ×1, judger ×1 | Show don't tell: artifacts and visual output are the deliverable; taste and polish matter |
| **Research panel**   | lead ×1, advisor ×2, judger ×2, writer ×1               | Read-only bias: analyze, weigh trade-offs, converge on one recommendation with evidence   |
| **Automation & ops** | lead ×1, scheduler ×2, coder ×1, judger ×1, writer ×1   | Unattended reliability: idempotent runs, loud failures, concise reports                   |

**Role-fill algorithm** (pure function, unit-tested): for each template slot in order, pick roster personalities holding the role, preferring preset slot-affinity (a template "coder ×2" takes both Builders), never reusing a member within one team; a slot that can't fill renders as a visible gap chip the user taps to pick a substitute (any personality) before the team can be created. With any 12-slot preset roster, all four templates fill with zero gaps by construction — a guardrail test asserts this for all three themes.

**Custom team**: name + pick any 6 personalities (the agent-teams `TeamEditModal` member checklist, reused) + optional team prompt.

**Activation**: after teams are created, one radio list — "Which team should be active?" (each team + "None"), default = the first created team. This is deliberately _more_ opt-in than the agent-teams seed rule (its "Otto Crew" seeds inactive because silent activation would change spawn behavior under existing users) — here the user explicitly built these teams seconds ago, so defaulting to active is the honest reading of intent. Commit = one config patch: `agentTeams` append + `activeAgentTeamId`.

### Step 5 — Done + welcome

Summary (interface mode, roster theme + count, teams + active), a one-liner pointing at Settings → Agents for everything created, and a warm welcome. Two exits, both of which first write `persistAppSettings({ hasCompletedSetupWizard: true })`:

- **"Start the tour"** → `router.replace(buildOpenProjectRoute())`, then kick the in-app spotlight tutorial (`tutorial/` — `useLaunchTutorial()` / the tutorial store) so it runs against the real home screen. The tour is gated by its own `hasCompletedTutorial` flag, so a device that already saw it won't re-run on a wizard re-entry.
- **"Skip for now"** → `router.replace(buildOpenProjectRoute())` only; the tour stays available (nothing marks `hasCompletedTutorial`).

The wizard's completion flag and the tutorial's completion flag are independent on purpose: re-running the wizard from About doesn't force the tour, and dismissing the tour doesn't reopen the wizard.

---

## Brand art & motion

The wizard's two bookends are the app's first real brand moment. They reuse the **feature-graphic art language** ([packages/app/demo/assets/feature-graphic.html](../../packages/app/demo/assets/feature-graphic.html)) — but built from the app's own **live** components, not a static recreation, so nothing drifts from the marketing asset.

### The reusable backdrop — `WizardBrandBackdrop`

A single component (`screens/setup-wizard/wizard-brand-backdrop.tsx`) renders the branded field behind both bookends, layered back-to-front:

1. **Brand field** — a fixed dark base (`#0b0b10`, the feature-graphic value). This is a deliberate always-dark brand moment (like a splash), _not_ theme-reactive: the welcome/close read the same in every app theme. (Open decision B.)
2. **Dual glow** — two soft radial gradients: indigo `rgba(99,91,255,0.22)` top-right, teal `rgba(45,212,191,0.10)` bottom-left. Native-safe via `react-native-svg` `RadialGradient` (the same primitive `BlobLoader`/`GlowLayer` already use) — no CSS `radial-gradient`, which is web-only.
3. **Masked grid** — 44px lines at ~3.5% white, radially masked to fade at the edges. Web can use a CSS mask; native falls back to a low-opacity ungated grid or omits it (perf + no CSS masks on native). Gate with `isWeb`; grid is decorative, so dropping it on native is acceptable.
4. **Hero cluster** — the `OttoLogo` glyph and the live `BlobLoader` (large — ~160–220px), composed like the feature graphic (glyph left/center, plasma ring as the companion light). `BlobLoader` is already self-animating, transparent-over-anything, and reads one shared clock, so it just works at size.

The backdrop is pure presentation and carries no wizard state — safe to mount on both the Welcome and Done steps.

### The wink

The welcome glyph animates in (fade + slight rise), holds, then **winks**: a brief crossfade `OttoLogo → OttoLogoWink → OttoLogo` (~180ms each way) using the reanimated pattern already in [startup-splash-screen.tsx](../../packages/app/src/screens/startup-splash-screen.tsx) (`useSharedValue` + `withSequence`/`withTiming`). Optionally repeat on a long idle interval. Respect the splash gotcha (docs/unistyles.md): the animated node uses **plain RN styles**, never unistyles, and the two glyph layers stack absolutely so opacity crossfades cleanly.

### Transitions

- **Welcome → steps:** on "Start", the brand cluster slides/fades out (translateX + opacity) while step 1 (Mode) slides in — a horizontal advance that sets the direction for the whole step sequence. Back reverses it.
- **Steps → Done:** entering Done slides the brand art back in from the opposite edge, mirroring the cover, so the wizard visually "closes the loop."
- **Middle steps (Mode…Teams):** plain cross-slide between steps, no brand art. Reuse one shared `WizardStepTransition` wrapper (a single reanimated layout animation) rather than bespoke per-step motion.
- Honor `prefers-reduced-motion` for the decorative slides/wink (fall back to a plain fade) — but never gate `BlobLoader` on it (it hard-codes `ReduceMotion.Never` for exactly this reason).

### Mobile-first sizing (non-negotiable)

The wizard's primary surface is a phone. Follow the established compact conventions ([docs/design.md](../../docs/design.md); the app's mobile-scaling memory): on compact, **icons render ~2× and body fonts bump ~+2px** vs. their base desktop sizes, and layout uses the `compactUp`/`useIsCompactFormFactor()` gates already in the codebase. Concretely for the bookends: the hero cluster scales down to fit narrow width (glyph + ring share a column, not a row, on compact), the brand field fills the safe area (status-bar offset per docs/floating-panels.md), cards stack full-width, and tap targets stay ≥44px. Verify both the mobile (375×812) and desktop viewports before calling any bookend done.

## Where the code lives (file map)

- **Shared (protocol):** `packages/protocol/src/personality-presets.ts` (the three themed rosters as slot/tier data + per-provider tier tables + Mixed roll helper), `packages/protocol/src/team-templates.ts` (template definitions + pure role-fill). Both sit next to `default-personalities.ts` and follow its stable-id + guardrail-test conventions. Protocol placement keeps the option of daemon-side reuse (e.g. a future CLI `otto setup`) open.
- **App:** `screens/setup-wizard/` — `setup-wizard-screen.tsx` (shell: step state, progress, skip), a `welcome-step.tsx` brand cover + one file per interactive step (`interface-mode-step.tsx`, `providers-step.tsx`, `personalities-step.tsx`, `teams-step.tsx`, `done-step.tsx`), plus the shared motion/brand pieces `wizard-brand-backdrop.tsx` and `wizard-step-transition.tsx`; `app/setup.tsx` (route); `navigation/host-runtime-bootstrap.ts` (resolver); `hooks/use-settings/storage.ts` (`hasCompletedSetupWizard`, `interfaceMode` — **shipped**), `hooks/use-interface-mode.ts` (gate — **shipped**); the **"Reset First Time Wizard"** row in the **About** section of `settings-screen.tsx`. Brand pieces reuse `components/blob-loader.tsx` and `components/icons/otto-logo.tsx` (`OttoLogo`/`OttoLogoWink`) — no new art assets.
- **Daemon:** nothing wizard-specific. The agent-teams dependency owns its daemon work; personality/team writes ride existing config-patch RPCs.
- **i18n:** all wizard strings in all eight locale files (type-enforced parity), English-first per house rule. Preset personality _content_ (names/prompts) is deliberately **not** localized — personalities are user data once installed, same as the shipped starter set.

## Build sequence

Each phase lands typecheck/lint/format green with its tests, independently shippable.

- **Phase 0 — dependency (tracked in the agent-teams charter):** agent-teams build steps 1–2 (schema, persistence, `features.agentTeams`, prompt composition). Wizard phases 1–3 don't block on this; phase 4 does.
- **Phase 1 — interface-mode plumbing** (the sub-plan's Phase 1, minus the standalone picker route). **Storage layer DONE (2026-07-12):** `interfaceMode: InterfaceMode | null` + `hasCompletedSetupWizard: boolean` fields, validators (`pickOnboardingSettings`), defaults, and `migrateSetupWizardFlag` backfill in [storage.ts](../../packages/app/src/hooks/use-settings/storage.ts) with tests; `useInterfaceMode()` / `useIsDeveloperMode()` + imperative snapshots in [use-interface-mode.ts](../../packages/app/src/hooks/use-interface-mode.ts) (`null → developer`); `interfaceMode` added to the `useSettings` update allowlist. **Remaining:** Settings → General segmented row, sidebar quick toggle, i18n, glossary entry. (The `hasCompletedSetupWizard` field was pulled forward from Phase 2 since it shares the same file + migration pattern as the tutorial flag already present.)
- **Phase 2 — wizard shell + bookends + steps 1–2. SHIPPED 2026-07-12 (uncommitted, static-green):** `/setup` route + `resolveStartupRoute` gate (fresh device + host → `/setup`, `isSetupWizardStateLoaded` splash guard) + 7 resolver tests; data-driven shell (progress/back/skip/continue chrome for middle steps, full-screen bookends); the winking Welcome cover + `WizardBrandBackdrop`; interface-mode step (persists on tap); providers step (snapshot list + auto-selected primary); done step (brand mirror + summary + tutorial handoff via `useTutorialStore.start()`); About → "Reset First Time Wizard" row (i18n all 8 locales). Deferred from this phase: `WizardStepTransition` (middle steps swap without a cross-slide for now); in-app visual verification on mobile/desktop (standing no-preview instruction — do before release). (The `hasCompletedSetupWizard` setting + backfill migration landed in Phase 1.)
- **Phase 3 — presets + personalities step:** `personality-presets.ts` (3 themes × 12, tier tables, Mixed roll, guardrail tests: role coverage ×2, unique ids/names, valid hex colors), pristine-roster detection, replace patch, non-pristine summary, build-your-own path via the reused editor.
- **Phase 4 — team templates + teams step:** `team-templates.ts` (+ fill-with-zero-gaps guardrail test against all themes), template multi-select, gap substitution, custom team path, activation radio, commit patch. Feature-gate card when `features.agentTeams` absent.
- **Phase 5 — User-mode surface gating:** the sub-plan's Phases 2–3 (hide the developer surfaces, then the friendly half), executed per [interface-modes.md](interface-modes.md). Sequenced after the wizard ships because until gating exists, picking "User" changes nothing visible — acceptable for one release (the setting is honest, the lens catches up), but called out in release notes.
- **Phase 6 — polish + fold-in:** E2E (fresh-install wizard journey, skip journey, second-device journey), translations, docs fold-in (below).

## Open decisions

1. **Tier→model tables per provider** — authored at build time against the live `provider-manifest.ts` catalogs; openai-compat endpoints have no stable catalog, so proposal: resolve all three tiers to the endpoint's first/default model and let the user retune later. Needs a look at real Codex/Copilot/OpenCode/Pi model lists.
2. **Primary-provider granularity** — one provider for the whole roster (proposed, simplest) vs per-tier overrides (e.g. local model for `fast`, Claude for `deep`). Start with one; the editor covers the rest.
3. **Second-device experience** — constraint 4 says steps 3–4 collapse to summaries; alternative is skipping them entirely for an even faster run. Proposal: show the summaries (they're the "informed" half of the wizard's mission — the second device user still learns what personalities and teams are).
4. **Daemon starter-set seeding** stays as-is (safety net for headless/CLI hosts and skipped wizards)? Proposal: yes — the pristine-check makes wizard replacement safe on top of it.
5. **Default active team = first created** — confirm this doesn't feel presumptuous in practice; the "None" option is one tap away.
6. **Preset content sign-off** — names above are locked pending user review; prompts, exact hex pairs, and voice casting reviewed as a batch during Phase 3 (the theming must read _strongly_).
7. **Wizard on web-without-daemon** (pure relay client) — the wizard needs a connected host; behavior is inherited from the resolver (no host ⇒ welcome, not wizard). No special casing expected; verify during Phase 2.

### Brand-art decisions

- **A. Welcome as a separate step vs. the cover of step 1** — proposal: a distinct **Welcome** cover screen (no config on it) that "Start" advances _into_ Mode. It configures nothing, so it isn't a numbered config step; it's the title card. Keeps Mode as "the first question."
- **B. Fixed-dark brand field vs. theme-reactive** — proposal: **fixed dark** (`#0b0b10`) for both bookends, matching the feature graphic, treated as a splash-like brand moment independent of the app theme. Revisit if it clashes badly with a light-theme user's expectation on the Done→home hop.
- **C. Masked grid on native** — proposal: web gets the radially-masked grid; native gets a plain low-opacity grid or none (no CSS masks on native, and it's decorative). Not worth a native mask shim in v1.
- **D. Wink cadence** — once on entry (locked); optional slow idle-repeat is a nice-to-have, decide during build against how it feels on device.

## Docs fold-in (when this ships)

Fold the wizard's routing/completion semantics into [docs/expo-router.md](../../docs/expo-router.md) (startup restore now has three stages: welcome → setup → open-project) and a short section in [docs/architecture.md](../../docs/architecture.md); preset/template catalogs get documented alongside the starter team in [docs/agent-personalities.md](../../docs/agent-personalities.md) and the future agent-teams doc; interface-modes fold-in per its own sub-plan (glossary entries, gate pattern). Update [docs/product.md](../../docs/product.md)'s onboarding story. Then delete this folder.
