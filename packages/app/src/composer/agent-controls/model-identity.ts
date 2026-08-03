import type { ModelTier } from "@otto-code/protocol/agent-types";
import { modelTierLabel } from "@/utils/model-tier-label";

/**
 * Everything the model picker's hover card states about the current selection.
 * Built from whatever the surface already resolved for its chips — nothing here
 * is fetched, so the card can never disagree with the trigger it hangs off.
 */
export interface ModelIdentityInput {
  /** Bound personality's display name, when one is selected. */
  personalityName: string | null | undefined;
  /** Human label of the selected model (never the raw id when we know better). */
  modelLabel: string | null | undefined;
  /** Human label of the provider the model comes from. */
  providerLabel: string | null | undefined;
  /** Capability tier stamped by the daemon; undefined ⇒ "Unknown". */
  tier: ModelTier | undefined;
  /** Effort/thinking level, already formatted. Null when the model has no levels. */
  effortLabel: string | null | undefined;
  /** Operating mode, already formatted. Null when the provider exposes none. */
  modeLabel: string | null | undefined;
  /**
   * Label of the model the provider actually ran the last turn on, when that is
   * not the selection above. Already decided by resolveRuntimeModelFact — a
   * label, never an id, so it stays a statement and never becomes a choice.
   */
  runtimeModelLabel: string | null | undefined;
}

export interface ModelIdentity {
  /** Headline: the personality's name when one is bound, else the model's label. */
  name: string;
  /**
   * The underlying model, carried as its own row ONLY when the headline is a
   * personality name — otherwise it would just repeat the headline.
   */
  modelLabel: string | null;
  providerLabel: string | null;
  /** Deep / Standard / Fast / Unknown. */
  classLabel: string;
  effortLabel: string | null;
  modeLabel: string | null;
  /** What actually ran last turn, when it differs from the selection. */
  runtimeModelLabel: string | null;
}

function cleanLabel(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Assemble the identity card for a selected model. Returns null when there is
 * nothing selected yet (no personality and no model) — callers fall back to the
 * plain "Change model" hint, because a card of empty rows says less than a
 * sentence does.
 */
export function buildModelIdentity(input: ModelIdentityInput): ModelIdentity | null {
  const personalityName = cleanLabel(input.personalityName);
  const modelLabel = cleanLabel(input.modelLabel);
  const name = personalityName ?? modelLabel;
  if (!name) {
    return null;
  }
  return {
    name,
    modelLabel: personalityName ? modelLabel : null,
    providerLabel: cleanLabel(input.providerLabel),
    classLabel: modelTierLabel(input.tier),
    effortLabel: cleanLabel(input.effortLabel),
    modeLabel: cleanLabel(input.modeLabel),
    runtimeModelLabel: cleanLabel(input.runtimeModelLabel),
  };
}
