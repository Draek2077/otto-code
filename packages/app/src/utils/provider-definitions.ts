import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import {
  type AgentModeColorTier,
  type AgentModeIcon,
  type AgentProviderDefinition,
  type AgentProviderModeDefinition,
} from "@otto-code/protocol/provider-manifest";

function buildProviderModes(entry: ProviderSnapshotEntry): AgentProviderModeDefinition[] {
  const entryModes = entry.modes ?? [];

  return entryModes.map((mode) =>
    Object.assign({}, mode, {
      icon: (mode.icon ?? "ShieldCheck") as AgentModeIcon,
      colorTier: (mode.colorTier ?? "neutral") as AgentModeColorTier,
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
    label: entry.label ?? entry.provider,
    description: entry.description ?? "",
    defaultModeId: entry.defaultModeId ?? null,
    modes: buildProviderModes(entry),
  }));
}

export function resolveProviderLabel(
  provider: string,
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): string {
  return snapshotEntries?.find((entry) => entry.provider === provider)?.label ?? provider;
}

/** The friendly display name for a model id (e.g. "Opus 4.8" for
 * "claude-opus-4-8"), resolved from the provider's snapshot model list. Falls
 * back to the raw id when the snapshot is absent or the model isn't listed. */
export function resolveModelLabel(
  provider: string,
  model: string,
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): string {
  const entry = snapshotEntries?.find((candidate) => candidate.provider === provider);
  return entry?.models?.find((candidate) => candidate.id === model)?.label ?? model;
}

export function resolveProviderDefinition(
  provider: string,
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): AgentProviderDefinition | undefined {
  return buildProviderDefinitions(snapshotEntries).find((definition) => definition.id === provider);
}
