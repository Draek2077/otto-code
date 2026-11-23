import { useCallback, useMemo } from "react";
import {
  SettingsCard,
  SettingsCollapsibleRow,
  SettingsRow,
  SettingsSection,
} from "@/components/settings";
import type { BrainSettingsChoice } from "./contracts";
import { useBrainSettings, useSettingsDisabled } from "./context";
import { IdentityPicker, OwnerText, OwnerToggle } from "./fields";
import { validateInteger } from "./drafts";
import { SettingsRows } from "./rows";

function DefaultModel() {
  const { state, model, snapshot } = useBrainSettings();
  const busy = useSettingsDisabled("owner");
  const change = useCallback(
    (choice: BrainSettingsChoice | null) => model.selectModel(choice),
    [model],
  );
  return (
    <IdentityPicker
      label="Default model"
      selected={state.displays.defaultModel}
      choices={snapshot.choices.models}
      onChange={change}
      disabled={busy || !snapshot.capabilities.residency}
    />
  );
}

function LockedModel({ index }: { index: number }) {
  const { state, model, snapshot } = useBrainSettings();
  const busy = useSettingsDisabled("owner");
  const change = useCallback(
    (choice: BrainSettingsChoice | null) => model.selectLockedModel(index, choice),
    [index, model],
  );
  return (
    <IdentityPicker
      label={`Locked model ${index + 1}`}
      selected={state.displays.locked[index] ?? null}
      choices={snapshot.choices.models}
      onChange={change}
      disabled={busy || !snapshot.capabilities.residency}
      noneLabel="None"
    />
  );
}

function LockedModels() {
  const { state, snapshot } = useBrainSettings();
  const owner = state.owner;
  if (!owner || !owner.draft.lockModel) return null;
  const draft = owner.draft;
  const limit = validateInteger(draft.maxLoadedModels, 1, 16)
    ? owner.origin.config.residency.maxLoadedModels
    : Number(draft.maxLoadedModels);
  const rows = Math.min(
    16,
    draft.lockedModelIds.length + (draft.lockedModelIds.length < limit ? 1 : 0),
  );
  if (!snapshot.capabilities.supported.residency) return null;
  return (
    <SettingsRows>
      {state.ownerErrors.lockedModelIds ? (
        <SettingsRow label="Locked model set" error={state.ownerErrors.lockedModelIds} />
      ) : null}
      {Array.from({ length: rows }, (_, index) => (
        <LockedModel key={index} index={index} />
      ))}
    </SettingsRows>
  );
}

function CacheType({ field, label }: { field: "cacheTypeK" | "cacheTypeV"; label: string }) {
  const { state, snapshot, model } = useBrainSettings();
  const busy = useSettingsDisabled("owner");
  const value = state.owner?.draft[field] ?? null;
  const choice = useMemo(() => (value === null ? null : { id: value, label: value }), [value]);
  const change = useCallback(
    (next: BrainSettingsChoice | null) => {
      if (next) model.editOwner(field, next.id);
    },
    [field, model],
  );
  return (
    <IdentityPicker
      label={label}
      selected={choice}
      choices={snapshot.choices.cacheTypes}
      onChange={change}
      disabled={busy || !snapshot.capabilities.defaults}
      noneLabel="Keep current value"
    />
  );
}

export function DefaultsSection() {
  const { state, snapshot } = useBrainSettings();
  const capability = snapshot.capabilities;
  if (!state.owner) return null;
  const invalidResidency =
    state.ownerErrors.maxLoadedModels !== undefined ||
    state.ownerErrors.lockedModelIds !== undefined;
  const invalidDefaults =
    state.ownerErrors.contextCap !== undefined ||
    state.ownerErrors.reasoningBudget !== undefined ||
    state.ownerErrors.parallelSlots !== undefined;
  return (
    <>
      {capability.supported.residency ? (
        <SettingsSection
          title="Model defaults"
          info="None leaves Brain unloaded until a request needs a model. Runtime and model library operations remain on Brain."
        >
          <SettingsCard>
            <DefaultModel />
            <SettingsCollapsibleRow
              key={invalidResidency ? "invalid-residency" : "residency"}
              label="Advanced residency"
              defaultExpanded={invalidResidency}
            >
              <OwnerText
                field="maxLoadedModels"
                label="Model processes"
                disabled={!capability.residency}
              />
              <OwnerToggle
                field="lockModel"
                label="Lock model set"
                disabled={!capability.residency}
              />
              <LockedModels />
            </SettingsCollapsibleRow>
          </SettingsCard>
        </SettingsSection>
      ) : null}
      {capability.supported.defaults ? (
        <SettingsSection
          title="New model preferences"
          info="Defaults apply through the owning host. Existing per-model profiles are preserved."
        >
          <SettingsCard>
            <SettingsCollapsibleRow
              key={invalidDefaults ? "invalid-defaults" : "defaults"}
              label="Advanced model defaults"
              defaultExpanded={invalidDefaults}
            >
              <CacheType field="cacheTypeK" label="K cache type" />
              <CacheType field="cacheTypeV" label="V cache type" />
              <OwnerToggle
                field="flashAttention"
                label="Flash attention"
                disabled={!capability.defaults}
              />
              <OwnerText
                field="reasoningBudget"
                label="Reasoning budget"
                disabled={!capability.defaults}
              />
              <OwnerText
                field="parallelSlots"
                label="Parallel slots"
                disabled={!capability.defaults}
              />
              <OwnerText field="contextCap" label="Context cap" disabled={!capability.defaults} />
            </SettingsCollapsibleRow>
          </SettingsCard>
        </SettingsSection>
      ) : null}
    </>
  );
}
