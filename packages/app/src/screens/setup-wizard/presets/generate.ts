/**
 * The team generator. Given a blueprint and the chosen provider's advertised
 * models/modes, it produces a concrete, installable team: six personalities (one
 * per slot, each a randomly-picked persona bound to a provider-resolved model)
 * plus the team that groups them.
 *
 * Everything provider-specific is resolved here, so the authored content stays
 * provider-agnostic:
 *   - tier → model: each model's tier is the daemon-stamped `model.tier`
 *     (override or shipped catalog; Unknown otherwise). The largest-context
 *     model per tier is picked, with a context-window heuristic filling any tier
 *     no known model claimed — so an LM Studio team of Unknown models still binds.
 *   - preferred modes → the first the provider advertises, else mode-unset.
 *
 * Randomness is injected (`random`, default Math.random) so tests are
 * deterministic. Names are drawn without replacement; colors are drawn distinct.
 */

import type {
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
} from "@otto-code/protocol/agent-types";
import type { AgentPersonality, AgentTeam } from "@otto-code/protocol/messages";
import { inferModelTier } from "@otto-code/protocol/model-tiers";
import { COLOR_PAIRS, NAME_POOLS, voiceForGender } from "./pools";
import { VARIATIONS } from "./variations";
import type { Archetype, NameGender, TeamBlueprint, Tier, Variation } from "./types";

/** User-managed per-model tier tags (`modelId → tier`), for the old-daemon path. */
export type ModelTierTags = Readonly<Record<string, Tier>>;

/**
 * Classify a single model into a tier, or null ("Unknown") when we don't know:
 *   1. the daemon-stamped `model.tier` (already folds in the user's override),
 *   2. an app-provided tag (only used against pre-tier daemons / in tests),
 *   3. the shipped catalog (known official ids only — no name guessing).
 * The context-window heuristic is a whole-list fallback (resolveTierModels), not
 * a per-model signal, so it isn't consulted here.
 */
export function classifyModelTier(model: AgentModelDefinition, tags?: ModelTierTags): Tier | null {
  return model.tier ?? tags?.[model.id] ?? inferModelTier(model) ?? null;
}

export interface GenerateTeamInput {
  blueprint: TeamBlueprint;
  provider: AgentProvider;
  models: readonly AgentModelDefinition[] | undefined;
  modes: readonly AgentMode[] | undefined;
  /** User-managed per-model tier tags; win over the catalog and patterns. */
  tierTags?: ModelTierTags;
  /** Injectable RNG for deterministic generation/tests. Defaults to Math.random. */
  random?: () => number;
}

export interface GeneratedTeam {
  personalities: AgentPersonality[];
  team: AgentTeam;
}

/** A tiny, dependency-free seeded RNG (mulberry32) for deterministic tests. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function token(random: () => number): string {
  return Math.floor(random() * 0xffffffff).toString(36);
}

/**
 * Resolve deep/standard/fast to concrete model ids from a provider's models.
 * Each model is classified (user tag → catalog → pattern); for each tier we pick
 * the largest-context model classified as that tier, and fill any tier no model
 * claimed with a context-window heuristic slot (biggest = deep, smallest = fast)
 * so all three are always bound. Returns null when the provider has no models.
 */
export function resolveTierModels(
  models: readonly AgentModelDefinition[] | undefined,
  tags?: ModelTierTags,
): Record<Tier, string> | null {
  if (!models || models.length === 0) {
    return null;
  }
  // Sort by context desc once: makes "largest-context match" a first-hit find,
  // and gives the heuristic its biggest/middle/smallest slots.
  const sorted = [...models].sort(
    (a, b) => (b.contextWindowMaxTokens ?? 0) - (a.contextWindowMaxTokens ?? 0),
  );
  const heuristic: Record<Tier, string> = {
    deep: sorted[0].id,
    standard: sorted[Math.floor((sorted.length - 1) / 2)].id,
    fast: sorted[sorted.length - 1].id,
  };
  const classifiedPick = (tier: Tier): string | undefined =>
    sorted.find((model) => classifyModelTier(model, tags) === tier)?.id;

  const pick = (tier: Tier): string => classifiedPick(tier) ?? heuristic[tier];
  return { deep: pick("deep"), standard: pick("standard"), fast: pick("fast") };
}

function resolveMode(
  preferredModeIds: readonly string[],
  modes: readonly AgentMode[] | undefined,
): string | undefined {
  if (!modes || modes.length === 0) {
    return undefined;
  }
  const advertised = new Set(modes.map((mode) => mode.id));
  return preferredModeIds.find((id) => advertised.has(id));
}

function pickIndex(length: number, random: () => number): number {
  return Math.min(length - 1, Math.floor(random() * length));
}

function drawName(gender: NameGender, random: () => number, used: Set<string>): string {
  const pool = NAME_POOLS[gender];
  const free = pool.filter((name) => !used.has(name));
  const source = free.length > 0 ? free : pool;
  const name = source[pickIndex(source.length, random)];
  used.add(name);
  return name;
}

function shuffledColors(random: () => number): AgentPersonality["spinner"][] {
  const copy = [...COLOR_PAIRS];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickVariation(blueprintId: string, slot: string, random: () => number): Variation | null {
  const list = VARIATIONS[blueprintId]?.[slot];
  if (!list || list.length === 0) {
    return null;
  }
  return list[pickIndex(list.length, random)];
}

function buildPersonality(input: {
  archetype: Archetype;
  variation: Variation;
  provider: AgentProvider;
  model: string;
  modeId: string | undefined;
  name: string;
  spinner: AgentPersonality["spinner"];
  voice: AgentPersonality["voice"];
  random: () => number;
}): AgentPersonality {
  const { archetype, variation, provider, model, modeId, name, spinner, voice } = input;
  const personality: AgentPersonality = {
    id: `personality_preset_${archetype.slot}_${token(input.random)}`,
    name,
    provider,
    model,
    effortLevel: archetype.effortLevel,
    respectGlobalAppendPrompt: true,
    roles: [...archetype.roles],
    personalityPrompt: `${archetype.functionalCore}\n\n${variation.flavor}`,
    spinner,
    voice,
  };
  if (modeId !== undefined) {
    personality.modeId = modeId;
  }
  return personality;
}

/**
 * Generate an installable team from a blueprint against a provider's snapshot.
 * Returns null when the provider advertises no models (nothing to bind to) — the
 * caller should surface "provider not ready" rather than install a broken team.
 */
export function generateTeam(input: GenerateTeamInput): GeneratedTeam | null {
  const { blueprint, provider, models, modes } = input;
  const random = input.random ?? Math.random;
  const tierModels = resolveTierModels(models, input.tierTags);
  if (!tierModels) {
    return null;
  }

  const usedNames = new Set<string>();
  const colors = shuffledColors(random);
  const genderCounters: Record<NameGender, number> = { m: 0, f: 0, n: 0 };

  const personalities: AgentPersonality[] = blueprint.slots.map((archetype, index) => {
    const variation =
      pickVariation(blueprint.id, archetype.slot, random) ??
      // Defensive: a slot with no authored variations still yields a valid member
      // from its functional core alone rather than crashing generation.
      ({ gender: "n", flavor: "" } satisfies Variation);
    const name = drawName(variation.gender, random, usedNames);
    const voice = voiceForGender(variation.gender, genderCounters[variation.gender]);
    genderCounters[variation.gender] += 1;
    return buildPersonality({
      archetype,
      variation,
      provider,
      model: tierModels[archetype.tier],
      modeId: resolveMode(archetype.preferredModeIds, modes),
      name,
      spinner: colors[index % colors.length],
      voice,
      random,
    });
  });

  const team: AgentTeam = {
    id: `team_preset_${blueprint.key}_${token(random)}`,
    name: blueprint.name,
    avatar: { color: blueprint.accent },
    teamPrompt: blueprint.teamPrompt,
    memberIds: personalities.map((personality) => personality.id),
  };

  return { personalities, team };
}
