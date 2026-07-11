import { PERSONALITY_ROLES, type AgentPersonality, type PersonalityRole } from "./messages.js";

// Pure, dependency-free personality helpers shared by the daemon (spawn-time
// resolution) and the app (picker availability + role filtering). Effort
// resolution is NOT here — it needs the model's advertised thinking options and
// lives with the daemon's effort resolver; availability does not depend on it.

const ROLE_SET: ReadonlySet<string> = new Set(PERSONALITY_ROLES);

export function isPersonalityRole(value: string): value is PersonalityRole {
  return ROLE_SET.has(value);
}

/**
 * Filter an arbitrary role array (roles ride the wire as plain strings) down to
 * the known set, deduped and returned in canonical `PERSONALITY_ROLES` order.
 * Unknown roles from a newer peer are dropped rather than trusted.
 */
export function normalizePersonalityRoles(roles: readonly string[] | undefined): PersonalityRole[] {
  if (!roles || roles.length === 0) {
    return [];
  }
  const present = new Set(roles.filter(isPersonalityRole));
  return PERSONALITY_ROLES.filter((role) => present.has(role));
}

export function personalityHasRole(
  personality: Pick<AgentPersonality, "roles">,
  role: PersonalityRole,
): boolean {
  return normalizePersonalityRoles(personality.roles).includes(role);
}

export type PersonalityUnavailableCode =
  | "provider-missing"
  | "provider-disabled"
  | "provider-not-ready"
  | "model-missing"
  | "mode-missing";

// Structural view of the target provider's snapshot entry, so both the app's
// snapshot shape and the daemon's ProviderSnapshotEntry can feed this without
// importing each other's types.
export interface PersonalityAvailabilityInput {
  /** Provider snapshot status, or undefined when the provider is absent entirely. */
  providerStatus: "ready" | "loading" | "error" | "unavailable" | undefined;
  providerEnabled: boolean | undefined;
  modelIds: readonly string[] | undefined;
  modeIds: readonly string[] | undefined;
}

export type PersonalityAvailability =
  | { available: true }
  | { available: false; code: PersonalityUnavailableCode; reason: string };

/**
 * Decide whether a personality is usable against a provider's current snapshot.
 * A personality is out of commission the moment any bound setting can't resolve:
 * provider absent/disabled/not-ready, model gone, or an explicit mode missing.
 * The caller grays it out in pickers and hard-fails it in automation.
 */
export function checkPersonalityAvailability(
  personality: Pick<AgentPersonality, "provider" | "model" | "modeId">,
  input: PersonalityAvailabilityInput,
): PersonalityAvailability {
  if (input.providerStatus === undefined) {
    return {
      available: false,
      code: "provider-missing",
      reason: `Provider "${personality.provider}" is not configured on this host.`,
    };
  }
  if (input.providerEnabled === false) {
    return {
      available: false,
      code: "provider-disabled",
      reason: `Provider "${personality.provider}" is disabled.`,
    };
  }
  if (input.providerStatus !== "ready") {
    return {
      available: false,
      code: "provider-not-ready",
      reason: `Provider "${personality.provider}" is not ready (${input.providerStatus}).`,
    };
  }
  if (!(input.modelIds ?? []).includes(personality.model)) {
    return {
      available: false,
      code: "model-missing",
      reason: `Model "${personality.model}" is not available from "${personality.provider}".`,
    };
  }
  if (personality.modeId !== undefined && !(input.modeIds ?? []).includes(personality.modeId)) {
    return {
      available: false,
      code: "mode-missing",
      reason: `Mode "${personality.modeId}" is not available from "${personality.provider}".`,
    };
  }
  return { available: true };
}
