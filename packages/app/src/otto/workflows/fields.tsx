import { useCallback } from "react";
import { Text, View } from "react-native";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { useIsCompactFormFactor } from "@/constants/layout";
import { styles } from "./styles";
export function TextField({
  label,
  value,
  onChange,
  multiline = false,
  disabled = false,
  epoch = 0,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  multiline?: boolean;
  disabled?: boolean;
  epoch?: number;
}) {
  const compact = useIsCompactFormFactor();
  return (
    <Field label={label}>
      <FormTextInput
        accessibilityLabel={label}
        initialValue={value}
        onChangeText={onChange}
        resetKey={epoch}
        multiline={multiline}
        editable={!disabled}
        size={compact ? "md" : "sm"}
        style={multiline ? styles.area : undefined}
      />
    </Field>
  );
}
export function Toggle({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.actions}>
      <Switch value={value} onValueChange={onChange} disabled={disabled} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}
export function JsonField({
  label,
  value,
  onChange,
  error,
  disabled = false,
}: {
  label: string;
  value: unknown;
  onChange(value: unknown): void;
  error(message: string): void;
  disabled?: boolean;
}) {
  const update = useCallback(
    (text: string) => {
      try {
        onChange(JSON.parse(text));
        error("");
      } catch {
        error(`${label}: enter valid JSON before saving.`);
      }
    },
    [label, onChange, error],
  );
  return (
    <TextField
      label={label}
      value={JSON.stringify(value, null, 2)}
      onChange={update}
      multiline
      disabled={disabled}
    />
  );
}
