import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { styles } from "./styles";
export function ViewTextField({
  label,
  value,
  change,
  multiline = false,
  disabled = false,
  epoch = 0,
}: {
  label: string;
  value: string;
  change(value: string): void;
  multiline?: boolean;
  disabled?: boolean;
  epoch?: number;
}) {
  const compact = useIsCompactFormFactor();
  return (
    <Field label={label}>
      <FormTextInput
        initialValue={value}
        onChangeText={change}
        resetKey={epoch}
        multiline={multiline}
        editable={!disabled}
        accessibilityLabel={label}
        size={compact ? "md" : "sm"}
        style={multiline ? styles.source : undefined}
      />
    </Field>
  );
}
