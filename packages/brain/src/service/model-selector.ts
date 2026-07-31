/**
 * Route-time model selection for the UNNAMED request path.
 *
 * When a client hits the brain without naming a model, the old default served
 * "whatever is loaded, else catalog[0]" — blind to which local model is actually
 * the best coder. This picks the best-ranked coding-capable model that fits the
 * VRAM budget instead, wiring together Track A (the bench ranking) and Track B1
 * (the catalog coding metadata carried onto the scanned Model).
 *
 * `selectCodingModel` is PURE: it takes the models, the ranking, an optional
 * VRAM-fit predicate, and a fallback, and returns the chosen model with no IO —
 * so the decision logic is trivially testable. `makeVramFitPredicate` is the one
 * impure edge (it reads GPU total VRAM and runs a vram.budget), deliberately kept
 * out of the pure path.
 */
import { ProfileSchema } from "../config/schema.js";
import type { RankedModel } from "../ops/results.js";
import type { GpuInfo, Model } from "../types.js";
import * as vram from "../vram.js";

// --- Minimum-confidence gate. A bench score is only "trusted" for ranking when
// it is backed by enough repeated runs and its spread across those runs is
// tight. rankModels reports one entry per model with the MEAN overall score
// (0..1), the run COUNT, and the sample STD (also 0..1). A single run has std 0
// — falsely confident — so we require at least two runs, and we reject a mean
// whose runs disagree by more than MAX_TRUSTED_STD. Untrusted models stay
// eligible but sort below every trusted one.
export const MIN_TRUSTED_RUNS = 2;
export const MAX_TRUSTED_STD = 0.15;

// --- Route-time fit probe. We do not have the saved per-model profile or a
// measured calibration here, so fit is tested at a modest working context: a
// model whose weights + KV at PROBE_CONTEXT_TOKENS overflow VRAM is excluded,
// and one that fits is includable (serve.ts clamps the real context down at load
// time via fitToBudget).
export const PROBE_CONTEXT_TOKENS = 8192;

const CODING_USE_CASE = "coding";
// Matches curated tier labels like "coding", "coder", "code-specialist".
const CODING_TIER_RE = /cod(ing|er|e-)/i;

/** Whether a scanned model carries catalog metadata marking it a coder. */
export function isCodingCapable(model: Model): boolean {
  if (model.useCases?.some((u) => u.toLowerCase() === CODING_USE_CASE)) return true;
  if (model.tier && CODING_TIER_RE.test(model.tier)) return true;
  return false;
}

export interface SelectCodingModelOptions {
  /** Every scanned model (the catalog the router already has). */
  models: Model[];
  /** Track A's per-model bench ranking (mean score + runs + std). */
  ranking: RankedModel[];
  /**
   * VRAM-fit predicate. Omit (or pass undefined) to skip the fit filter — the
   * caller does this when GPU info is absent, mirroring serve.ts's "absent →
   * skip" behaviour.
   */
  fits?: (model: Model) => boolean;
  /** Id of the currently-loaded model, a tiebreak to avoid a needless swap. */
  preferLoadedId?: string | null;
  /** The existing default, returned when no candidate survives. */
  fallback: Model | null;
}

/** A candidate paired with its confidence-gated score, for sorting. */
interface Ranked {
  model: Model;
  trusted: boolean;
  score: number;
}

/** Look a scanned model up in the ranking by id first, then display name. */
function rankingLookup(ranking: RankedModel[]): (model: Model) => RankedModel | null {
  const byId = new Map<string, RankedModel>();
  const byName = new Map<string, RankedModel>();
  for (const entry of ranking) {
    if (entry.id) byId.set(entry.id, entry);
    if (!byName.has(entry.displayName)) byName.set(entry.displayName, entry);
  }
  return (model) => byId.get(model.id) ?? byName.get(model.displayName) ?? null;
}

/**
 * Decision order:
 *   trusted bench score (desc) → any bench score (desc, untrusted-with-data over
 *   none) → loaded model (avoid a swap) → larger advertised context → name.
 * The trailing name comparison makes the order total, so the pick is fully
 * deterministic given the same inputs.
 */
function compareCandidates(a: Ranked, b: Ranked, preferLoadedId: string | null): number {
  if (a.trusted !== b.trusted) return a.trusted ? -1 : 1;
  if (a.score !== b.score) return b.score - a.score;
  const aLoaded = preferLoadedId != null && a.model.id === preferLoadedId;
  const bLoaded = preferLoadedId != null && b.model.id === preferLoadedId;
  if (aLoaded !== bLoaded) return aLoaded ? -1 : 1;
  const aCtx = a.model.contextMax ?? 0;
  const bCtx = b.model.contextMax ?? 0;
  if (aCtx !== bCtx) return bCtx - aCtx;
  return a.model.displayName.localeCompare(b.model.displayName);
}

/**
 * Pick the best-ranked coding model that fits the VRAM budget. Pure and
 * deterministic — no IO, no clock, no randomness.
 */
export function selectCodingModel({
  models,
  ranking,
  fits,
  preferLoadedId = null,
  fallback,
}: SelectCodingModelOptions): Model | null {
  if (models.length === 0) return fallback;

  // 1. Candidate set: coding-capable models. If nothing is tagged (a catalog
  //    with no coding metadata, or hand-placed models), don't fail closed —
  //    fall back to the whole set.
  const tagged = models.filter(isCodingCapable);
  let candidates = tagged.length > 0 ? tagged : models;

  // 2. VRAM fit filter (skipped when no predicate — i.e. GPU info absent). If
  //    nothing coding-capable fits, keep the existing default rather than
  //    forcing a model that overflows the budget.
  if (fits) {
    const fitting = candidates.filter((m) => fits(m));
    if (fitting.length === 0) return fallback;
    candidates = fitting;
  }

  // 3. Rank by bench score behind the confidence gate.
  const lookup = rankingLookup(ranking);
  const scored: Ranked[] = candidates.map((model) => {
    const entry = lookup(model);
    const trusted = Boolean(
      entry && entry.runs >= MIN_TRUSTED_RUNS && entry.std <= MAX_TRUSTED_STD,
    );
    const score = entry ? entry.overall : Number.NEGATIVE_INFINITY;
    return { model, trusted, score };
  });

  scored.sort((a, b) => compareCandidates(a, b, preferLoadedId));
  return scored[0]?.model ?? fallback;
}

/**
 * Build the route-time VRAM-fit predicate, or undefined when GPU info is absent
 * (no nvidia-smi) so the caller skips the fit filter entirely. The probe profile
 * is built once and reused: a model fits when its weights + KV at
 * PROBE_CONTEXT_TOKENS sit inside the card's total VRAM budget.
 */
export function makeVramFitPredicate(gpu: GpuInfo | null): ((model: Model) => boolean) | undefined {
  if (!gpu) return undefined;
  const profile = ProfileSchema.parse({ contextSize: PROBE_CONTEXT_TOKENS });
  const totalVramBytes = gpu.totalBytes;
  return (model: Model): boolean => vram.budget({ model, profile, totalVramBytes }).fits;
}
