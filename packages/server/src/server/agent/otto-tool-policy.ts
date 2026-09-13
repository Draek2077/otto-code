import type { ProviderOttoToolsPolicy } from "@otto-code/protocol/provider-config";

interface ProviderOttoToolSettings {
  ottoTools?: ProviderOttoToolsPolicy;
}

export function resolveOttoToolPolicy(
  providerId: string,
  providerSettings: Readonly<Record<string, ProviderOttoToolSettings>> | undefined,
): ProviderOttoToolsPolicy | undefined {
  return providerSettings?.[providerId]?.ottoTools;
}

/** Provider-specific restriction intersects the host, group and workspace ceilings. */
export function isOttoToolEnabled(
  policy: ProviderOttoToolsPolicy | undefined,
  toolName: string,
  source?: "connector",
): boolean {
  // An explicit name deny applies even to voice and separately authorized connectors.
  if (policy?.disabledTools?.includes(toolName)) return false;
  // `enabled` controls the Otto built-in catalog. Connector grants have their own host switches.
  if (source === "connector") return true;
  return isOttoToolPolicyEnabled(policy);
}

export function isOttoToolPolicyEnabled(policy: ProviderOttoToolsPolicy | undefined): boolean {
  return policy?.enabled !== false;
}
