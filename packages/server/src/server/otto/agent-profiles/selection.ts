import { resolveEffortOption } from "@getpaseo/protocol/otto/profile-effort";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import {
  bindProfile,
  presentationLabel,
  type ProfileBinding,
} from "@getpaseo/protocol/otto/agent-teams";
import type { AgentProfile } from "@getpaseo/protocol/agent-profile";
import type { AgentProviderNotice, AgentSessionConfig } from "../../agent/agent-sdk-types.js";

type Roster = Parameters<typeof bindProfile>[0];
export function emptyRoster(): Roster {
  return {};
}
export function rosterReader(read?: () => Roster) {
  return read ?? emptyRoster;
}
export function reloadLabels(current: Record<string, string>, override?: Record<string, string>) {
  return override ?? current;
}

type Catalog = (provider: string, cwd: string) => Promise<ProviderSnapshotEntry>;
export async function resolveHostProfile(
  roster: Roster,
  id: string,
  config: AgentSessionConfig,
  catalog?: Catalog,
) {
  const selected = bindProfile(roster, id, config.provider);
  if (!catalog) return selected;
  const { profile } = selected;
  const entry = await catalog(config.provider, config.cwd);
  const models = entry.models ?? [];
  const modelId = profile.model || config.model;
  const model = modelId
    ? models.find((item) => item.id === modelId)
    : (models.find((item) => item.isDefault) ?? models[0]);
  if (!entry.enabled || entry.status !== "ready" || (profile.model && !model))
    throw new Error("The selected Profile's provider or model is unavailable.");
  if (profile.modeId && entry.modes && !entry.modes.some((mode) => mode.id === profile.modeId))
    throw new Error("The selected Profile's mode is unavailable.");
  const requested =
    profile.thinkingOptionId ||
    (typeof profile.effortLevel === "string" ? profile.effortLevel : "");
  if (!requested) return selected;
  const effort = resolveEffortOption({ requested, thinkingOptions: model?.thinkingOptions ?? [] });
  return { ...selected, profile: { ...profile, thinkingOptionId: effort.optionId } };
}
export function profileConfig(
  profile: AgentProfile | undefined,
  model: string | null | undefined,
  features: AgentSessionConfig["featureValues"],
): Partial<AgentSessionConfig> {
  return {
    ...(model !== undefined ? { model: model ?? undefined } : {}),
    ...(profile?.modeId ? { modeId: profile.modeId } : {}),
    ...(profile?.thinkingOptionId ? { thinkingOptionId: profile.thinkingOptionId } : {}),
    ...(profile?.featureValues ? { featureValues: { ...features, ...profile.featureValues } } : {}),
  };
}

export function applyCreationProfile(
  config: AgentSessionConfig,
  profile: AgentProfile,
  binding: ProfileBinding,
): AgentSessionConfig {
  return {
    ...config,
    ...profileConfig(profile, profile.model ?? config.model, config.featureValues),
    modeId: config.modeId ?? profile.modeId,
    thinkingOptionId: config.thinkingOptionId ?? profile.thinkingOptionId,
    featureValues: { ...profile.featureValues, ...config.featureValues },
    ottoProfile: binding,
  };
}
interface Port {
  refreshMemory?(next?: ProfileBinding): Promise<boolean>;
  setModel(model: string | null): Promise<void>;
  setMode(mode: string): Promise<AgentProviderNotice | null>;
  setThinking(thinking: string): Promise<AgentProviderNotice | null>;
  setFeature(id: string, value: unknown): Promise<void>;
  writeBinding(binding: ProfileBinding | undefined, label: string | null): Promise<void>;
  resume(config: Partial<AgentSessionConfig>, label: string | null): Promise<void>;
}
function promptChanged(old?: ProfileBinding, next?: ProfileBinding) {
  return (
    (old?.prompt ?? "") !== (next?.prompt ?? "") ||
    (old?.respectGlobal ?? true) !== (next?.respectGlobal ?? true)
  );
}
function liveChanges(
  config: AgentSessionConfig,
  port: Port,
  model: string | null | undefined,
  profile?: AgentProfile,
) {
  const changes: (() => Promise<AgentProviderNotice | null | void>)[] = [];
  if (model !== undefined && (!profile || model !== config.model))
    changes.push(() => port.setModel(model));
  const mode = profile?.modeId;
  if (mode && mode !== config.modeId) changes.push(() => port.setMode(mode));
  const effort = profile?.thinkingOptionId;
  if (effort && effort !== config.thinkingOptionId) changes.push(() => port.setThinking(effort));
  for (const [key, value] of Object.entries(profile?.featureValues ?? {})) {
    if (value !== config.featureValues?.[key]) changes.push(() => port.setFeature(key, value));
  }
  return changes;
}
export async function selectProfile(
  config: AgentSessionConfig,
  previousLabel: string | undefined,
  selected: ReturnType<typeof bindProfile> | null,
  rawModel: string | null | undefined,
  port: Port,
) {
  const profile = selected?.profile;
  const binding = selected?.binding;
  const model = profile?.model ?? rawModel;
  const label = binding ? presentationLabel(binding) : null;
  const changes = liveChanges(config, port, model, profile);
  // Several independent provider setters can leave a chat half switched if a later setter fails.
  // Submit the complete configuration in one provider resume before publishing the identity.
  if (
    changes.length > 1 ||
    promptChanged(config.ottoProfile, binding) ||
    (config.ottoProfile?.id !== binding?.id && (await port.refreshMemory?.(binding)))
  ) {
    await port.resume(
      { ...profileConfig(profile, model, config.featureValues), ottoProfile: binding },
      label,
    );
    return null;
  }
  const notice = (await changes[0]?.()) ?? null;
  if (binding || config.ottoProfile || previousLabel) await port.writeBinding(binding, label);
  return notice;
}
