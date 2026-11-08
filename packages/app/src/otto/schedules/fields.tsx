import { useCallback, useMemo } from "react";
import { View, Text } from "react-native";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { useIsCompactFormFactor } from "@/constants/layout";
import { styles } from "./styles";

export function ScheduleText({
  label,
  value,
  change,
  multiline = false,
  disabled = false,
  epoch = 0,
  testID,
}: {
  label: string;
  value: string;
  change(value: string): void;
  multiline?: boolean;
  disabled?: boolean;
  epoch?: number;
  testID?: string;
}) {
  const compact = useIsCompactFormFactor();
  return (
    <Field label={label}>
      <FormTextInput
        initialValue={value}
        resetKey={epoch}
        onChangeText={change}
        accessibilityLabel={label}
        testID={testID}
        editable={!disabled}
        multiline={multiline}
        size={compact ? "md" : "sm"}
        style={multiline ? styles.area : undefined}
      />
    </Field>
  );
}
export function ScheduleChoice({
  label,
  value,
  display,
  options,
  change,
  disabled = false,
  testID,
}: {
  label: string;
  value: string | null;
  display?: string;
  options: { value: string; label: string }[];
  change(value: string): void;
  disabled?: boolean;
  testID?: string;
}) {
  const compact = useIsCompactFormFactor();
  const rows = useMemo(
    () => options.map((row) => ({ ...row, id: row.value, testID: `schedule-choice-${row.value}` })),
    [options],
  );
  const selected = useMemo(() => (display ? { label: display } : null), [display]);
  return (
    <SelectField
      label={label}
      value={value}
      selectedDisplay={selected}
      options={rows}
      onChange={change}
      disabled={disabled}
      title={label}
      emptyText="No available choices"
      placeholder={`Select ${label.toLowerCase()}`}
      size={compact ? "md" : "sm"}
      triggerTestID={testID}
      searchable={rows.length > 6}
    />
  );
}
export function ScheduleToggle({
  label,
  value,
  change,
  disabled = false,
  testID,
}: {
  label: string;
  value: boolean;
  change(value: boolean): void;
  disabled?: boolean;
  testID?: string;
}) {
  const onValueChange = useCallback((next: boolean) => change(next), [change]);
  return (
    <View style={styles.actions}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        testID={testID}
      />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}
