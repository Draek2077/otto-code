import type { SavedProviderEndpoint } from "@otto-code/protocol/messages";

/**
 * Remembered provider endpoints — the base URL + credential pairs a host has
 * saved in the provider settings sheet, so pointing a provider back at a
 * previous endpoint is one pick instead of re-typing the key.
 *
 * Entries are pooled by the connection env-var family they belong to, not by
 * provider id: every openai-compatible/codex provider entry on the host shares
 * the OPENAI_BASE_URL pool, and Claude-compatible entries share the
 * ANTHROPIC_BASE_URL one. That's what makes an endpoint saved under one custom
 * provider reusable from another.
 */

/**
 * How many endpoints we keep per family. High enough that a real roster of
 * endpoints (a couple of local runtimes plus a handful of hosted ones) never
 * evicts, low enough that the dropdown stays scannable and config.json stays
 * small.
 */
export const SAVED_PROVIDER_ENDPOINT_LIMIT = 12;

/** Stable identity for an endpoint — re-saving the same URL updates in place. */
export function savedProviderEndpointId(baseUrlKey: string, baseUrl: string): string {
  return `${baseUrlKey}::${baseUrl}`;
}

/** The endpoints belonging to one connection family, newest save first. */
export function selectSavedProviderEndpoints(
  endpoints: readonly SavedProviderEndpoint[],
  baseUrlKey: string,
): SavedProviderEndpoint[] {
  return endpoints
    .filter((entry) => entry.baseUrlKey === baseUrlKey)
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

/** The saved entry for an exact base URL within a family, if there is one. */
export function findSavedProviderEndpoint(
  endpoints: readonly SavedProviderEndpoint[],
  baseUrlKey: string,
  baseUrl: string,
): SavedProviderEndpoint | null {
  const id = savedProviderEndpointId(baseUrlKey, baseUrl);
  return endpoints.find((entry) => entry.id === id) ?? null;
}

/**
 * Record an endpoint that was just saved into a provider. Replaces any prior
 * entry for the same URL (so the credential tracks the latest save rather than
 * accumulating stale copies) and trims the family back to the limit, evicting
 * the least recently saved. Other families are left untouched.
 */
export function rememberProviderEndpoint(params: {
  endpoints: readonly SavedProviderEndpoint[];
  baseUrlKey: string;
  apiKeyKey: string;
  baseUrl: string;
  apiKey: string;
  savedAt: number;
}): SavedProviderEndpoint[] {
  const { endpoints, baseUrlKey, apiKeyKey, baseUrl, apiKey, savedAt } = params;
  const id = savedProviderEndpointId(baseUrlKey, baseUrl);
  const existing = endpoints.find((entry) => entry.id === id);
  const entry: SavedProviderEndpoint = {
    id,
    baseUrlKey,
    apiKeyKey,
    baseUrl,
    apiKey,
    savedAt,
    // A label the user gave this endpoint outlives the credential rotation
    // that re-saves it.
    ...(existing?.label !== undefined ? { label: existing.label } : {}),
  };

  const others = endpoints.filter((candidate) => candidate.baseUrlKey !== baseUrlKey);
  const family = [entry, ...selectSavedProviderEndpoints(endpoints, baseUrlKey)]
    .filter((candidate, index) => index === 0 || candidate.id !== id)
    .slice(0, SAVED_PROVIDER_ENDPOINT_LIMIT);

  return [...family, ...others];
}

/** Drop a remembered endpoint by id. */
export function forgetProviderEndpoint(
  endpoints: readonly SavedProviderEndpoint[],
  id: string,
): SavedProviderEndpoint[] {
  return endpoints.filter((entry) => entry.id !== id);
}
