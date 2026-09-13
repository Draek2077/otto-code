import React from "react";
import {
  SettingsSection as BaseSection,
  type SettingsSectionProps as SectionProps,
} from "@/components/settings/headings/settings-section";
import { Field as BaseField, type FieldProps } from "@/components/ui/form-field";
import {
  SelectField as BaseSelectField,
  type SelectFieldProps,
} from "@/components/ui/select-field";
import { SettingsTargetLabel, SettingsTargetScope } from "./target";

export function SettingsField(props: FieldProps) {
  return <BaseField {...props} Label={SettingsTargetLabel} />;
}
export function SettingsSelectField<TValue>(props: SelectFieldProps<TValue>) {
  return <BaseSelectField {...props} Label={SettingsTargetLabel} />;
}

export function SettingsSection({
  settingIds,
  ...props
}: SectionProps & { settingIds: readonly string[] }) {
  return (
    <SettingsTargetScope settingIds={settingIds}>
      <BaseSection {...props} Label={SettingsTargetLabel} />
    </SettingsTargetScope>
  );
}
