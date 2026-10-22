import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
// OTTO(provider-identity): keep display labels separate from stable provider IDs.
import { ottoProviderLabel } from "@/otto/provider-identity";
import {
  type AgentModeColorTier,
  type AgentModeIcon,
  type AgentProviderDefinition,
  type AgentProviderModeDefinition,
} from "@getpaseo/protocol/provider-manifest";

function buildProviderModes(entry: ProviderSnapshotEntry): AgentProviderModeDefinition[] {
  const entryModes = entry.modes ?? [];

  return entryModes.map((mode) =>
    Object.assign({}, mode, {
      icon: (mode.icon ?? "ShieldCheck") as AgentModeIcon,
      colorTier: (mode.colorTier ?? "moderate") as AgentModeColorTier,
    }),
  );
}

export function buildProviderDefinitions(
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): AgentProviderDefinition[] {
  if (!snapshotEntries?.length) {
    return [];
  }

  return snapshotEntries.map((entry) => ({
    id: entry.provider,
    // OTTO(provider-identity)
    label: ottoProviderLabel(entry.provider, entry.label ?? entry.provider),
    description: entry.description ?? "",
    defaultModeId: entry.defaultModeId ?? null,
    modes: buildProviderModes(entry),
  }));
}

export function resolveProviderLabel(
  provider: string,
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): string {
  // OTTO(provider-identity)
  return ottoProviderLabel(
    provider,
    snapshotEntries?.find((entry) => entry.provider === provider)?.label ?? provider,
  );
}

export function resolveProviderDefinition(
  provider: string,
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): AgentProviderDefinition | undefined {
  return buildProviderDefinitions(snapshotEntries).find((definition) => definition.id === provider);
}
