import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SelectField } from "@/components/ui/select-field";
/** Shared scope control for Otto's global browsers; the normal screen header owns the title. */
export function FeatureScopeSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange(value: string): void;
}) {
  const choices = useMemo(
    () => options.map((option) => ({ ...option, id: option.value })),
    [options],
  );
  const selectedDisplay = useMemo(
    () => choices.find((option) => option.value === value) ?? null,
    [choices, value],
  );
  return (
    <View style={featureBrowserStyles.picker}>
      <SelectField
        label={label}
        value={value}
        selectedDisplay={selectedDisplay}
        options={choices}
        onChange={onChange}
        placeholder={`Choose a ${label.toLowerCase()}`}
        emptyText={`No ${label.toLowerCase()}s available`}
        field={false}
        size="sm"
      />
    </View>
  );
}
export const featureBrowserStyles = StyleSheet.create((theme) => ({
  toolbar: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[2],
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  picker: { minWidth: 180, maxWidth: "100%", flexShrink: 1 },
}));
