import { useCallback, useMemo } from "react";
import {
  SettingsCard,
  SettingsCollapsibleRow,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@/components/settings";
import { SelectField } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { BrainLogVerbosity, BrainRuntimeSource, BrainSettingsChoice } from "./contracts";
import { useBrainSettings, useSettingsDisabled } from "./context";
import { IdentityPicker, OwnerText, ValueRow } from "./fields";
import { currentOwnerFacts } from "./presentation";

const SOURCES: readonly { value: BrainRuntimeSource; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "managed", label: "Managed" },
  { value: "lmstudio", label: "LM Studio" },
];
const LOG_LEVELS: { id: string; value: BrainLogVerbosity; label: string }[] = [
  { id: "0", value: 0, label: "Generic output (0)" },
  { id: "1", value: 1, label: "Errors (1)" },
  { id: "2", value: 2, label: "Warnings (2)" },
  { id: "3", value: 3, label: "Info (3, default)" },
  { id: "4", value: 4, label: "Trace (4)" },
  { id: "5", value: 5, label: "Debug (5)" },
];

function LogVerbosity() {
  const { model, state, snapshot } = useBrainSettings();
  const busy = useSettingsDisabled("owner");
  const compact = useIsCompactFormFactor();
  const value = state.owner?.draft.logVerbosity;
  const display = useMemo(
    () => ({ label: LOG_LEVELS.find((option) => option.value === value)?.label ?? "Not reported" }),
    [value],
  );
  const change = useCallback(
    (next: BrainLogVerbosity) => model.editOwner("logVerbosity", next),
    [model],
  );
  if (value === undefined || !snapshot.capabilities.supported.logging) return null;
  return (
    <SettingsRow label="Runtime log verbosity">
      <SelectField<BrainLogVerbosity>
        field={false}
        size={compact ? "md" : "sm"}
        label="Runtime log verbosity"
        value={value}
        selectedDisplay={display}
        options={LOG_LEVELS}
        onChange={change}
        placeholder="Select log level"
        emptyText="No log levels available"
        disabled={busy || !snapshot.capabilities.logging}
      />
    </SettingsRow>
  );
}

function RuntimeSelection() {
  const { model, state, snapshot } = useBrainSettings();
  const busy = useSettingsDisabled("owner");
  const change = useCallback(
    (choice: BrainSettingsChoice | null) => model.selectRuntime(choice),
    [model],
  );
  const draft = state.owner?.draft;
  if (!draft) return null;
  const nullDisplay = draft.runtimePath
    ? "Explicit owner path"
    : SOURCES.find((source) => source.value === draft.runtimeSource)?.label;
  return (
    <IdentityPicker
      label="Installed runtime"
      selected={state.displays.runtime}
      choices={snapshot.choices.runtimes}
      onChange={change}
      disabled={busy || !snapshot.capabilities.runtime}
      noneLabel="Automatic"
      nullDisplay={nullDisplay}
      unlistedSelection={draft.runtimePath !== "" || draft.runtimeSource !== "auto"}
    />
  );
}

function RuntimeSourcePolicy() {
  const { model, state, snapshot } = useBrainSettings();
  const busy = useSettingsDisabled("owner");
  const change = useCallback(
    (source: BrainRuntimeSource) => model.selectRuntimeSource(source),
    [model],
  );
  const draft = state.owner?.draft;
  if (!draft) return null;
  return (
    <SettingsSelect
      label="Runtime source"
      value={draft.runtimeSource}
      options={SOURCES}
      onValueChange={change}
      disabled={busy || !snapshot.capabilities.runtime}
    />
  );
}

function capacity(total: number | null, free: number | null): string {
  if (total === null || free === null) return "Not reported";
  return `${(free / 1024 ** 3).toFixed(1)} GiB free of ${(total / 1024 ** 3).toFixed(1)} GiB`;
}

export function RuntimeStorageSection() {
  const { state, snapshot } = useBrainSettings();
  const owner = state.owner?.origin;
  const capability = snapshot.capabilities;
  if (!owner) return null;
  const facts = currentOwnerFacts(snapshot, owner);
  return (
    <>
      {capability.supported.runtime || capability.supported.logging ? (
        <SettingsSection
          title="Runtime"
          info={`Runtime paths and launch preferences belong to ${owner.owner.label}. Saved changes apply on an explicit model load or restart.`}
        >
          <SettingsCard>
            <ValueRow label="Current runtime" value={facts.resolved.runtimeLabel} />
            {capability.supported.runtime ? <RuntimeSelection /> : null}
            <LogVerbosity />
            {capability.supported.runtime ? (
              <SettingsCollapsibleRow label="Advanced runtime">
                <RuntimeSourcePolicy />
                <OwnerText
                  field="runtimePath"
                  label={`Executable override on ${owner.owner.label}`}
                  disabled={!capability.runtime}
                />
                <ValueRow
                  label="Resolved executable"
                  value={facts.resolved.executablePath ?? "Not reported"}
                />
              </SettingsCollapsibleRow>
            ) : null}
          </SettingsCard>
        </SettingsSection>
      ) : null}
      {capability.supported.storage ? (
        <SettingsSection
          title="Model storage"
          info={`These locations and filesystem capacity belong to ${owner.owner.label}. Saving a directory preference does not move existing files.`}
        >
          <SettingsCard>
            <ValueRow label="Model directory" value={facts.resolved.modelsDirectory} />
            <ValueRow
              label="Host filesystem"
              value={capacity(facts.resolved.totalBytes, facts.resolved.freeBytes)}
            />
            <SettingsCollapsibleRow label="Advanced storage">
              <OwnerText
                field="modelsDirectory"
                label={`Model directory override on ${owner.owner.label}`}
                disabled={!capability.storage}
              />
            </SettingsCollapsibleRow>
          </SettingsCard>
        </SettingsSection>
      ) : null}
    </>
  );
}
