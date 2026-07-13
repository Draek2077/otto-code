/**
 * Themed team presets — the type layer.
 *
 * Three layers keep the system tractable (see the design in
 * projects/first-time-wizard/first-time-wizard.md):
 *
 *  1. Blueprint  — a team type's fixed role skeleton (6 slots, one orchestrator).
 *                  Never randomizes; this is what guarantees balance.
 *  2. Archetype  — a single slot: roles + brain tier + a *functional* prompt core
 *                  (what this member does). Fixed per slot.
 *  3. Variation  — a styled realization of an archetype: a persona (temperament,
 *                  quirks, voice) written on top of the functional core, plus a
 *                  name-gender pool to draw from. Three per slot; one is picked at
 *                  random per generation.
 *
 * At generate-time (generate.ts) each slot picks 1 of its 3 variations, draws a
 * unique name from the variation's gender pool, and draws a distinct color pair.
 * Balance comes from the blueprint; variety comes from 3^slots × name/color draws
 * (3^6 = 729 balanced rosters per team type before names/colors even vary).
 *
 * Provider-agnostic by construction: archetypes bind a `tier` (deep/standard/fast)
 * and canonical `effortLevel`, not a concrete model. generate.ts resolves the tier
 * against the chosen provider's advertised models, so a generated LM Studio team is
 * as valid as a Claude one.
 */

import type { PersonalityRole } from "@otto-code/protocol/messages";

/** Which brain a slot wants; resolved to a concrete model per provider. */
export type Tier = "deep" | "standard" | "fast";

/** Interface-mode lens a blueprint belongs to (drives which cards a mode shows). */
export type PresetLens = "developer" | "user";

/** Name pool a variation draws from. Randomized *selection*, fixed *pool*. */
export type NameGender = "m" | "f" | "n";

/**
 * One team slot: the fixed functional identity. `functionalCore` describes the
 * job (shared by all 3 variations); the persona is layered on at generate-time.
 */
export interface Archetype {
  /** Stable slot id within a blueprint, e.g. "lead", "critic". */
  slot: string;
  /** Human label for previews, e.g. "Team Lead". */
  label: string;
  /** Canonical roles (drives orchestration + picker scoping). */
  roles: PersonalityRole[];
  /** Brain tier; resolved to a model per provider. */
  tier: Tier;
  /** Canonical effort level ("off".."max"); resolved to the model's nearest option. */
  effortLevel: string;
  /**
   * Preferred provider modes in priority order. generate.ts binds the first one
   * the provider advertises; if none match, the personality is left mode-unset
   * (provider default) rather than out-of-commission.
   */
  preferredModeIds: string[];
  /** The job. Fixed across variations; prepended to the persona flavor. */
  functionalCore: string;
}

/**
 * A persona layered on an archetype. `flavor` is written gender-consistent with
 * `gender` and deliberately avoids naming specific colors (colors randomize).
 */
export interface Variation {
  /** Which name pool to draw this member's name from. */
  gender: NameGender;
  /** Persona prose — temperament, quirks, communication style. */
  flavor: string;
}

/** A team type: fixed skeleton + themed identity. */
export interface TeamBlueprint {
  /** Stable id, e.g. "dev_application". Prefix `team_preset_*` at generate-time. */
  id: string;
  lens: PresetLens;
  /** Short key within the lens, e.g. "application". */
  key: string;
  /** Card title, e.g. "Application Team". */
  name: string;
  /** One-line card description. */
  tagline: string;
  /** Themed accent (team avatar color + card accent). */
  accent: string;
  /** Team-level prompt (stacks above each member's personality prompt). */
  teamPrompt: string;
  /** Ordered slots — exactly one orchestrator, 6 members. */
  slots: Archetype[];
}

/** Authored variations, keyed by blueprint id then slot id. Three per slot. */
export type VariationTable = Record<string, Record<string, readonly Variation[]>>;
