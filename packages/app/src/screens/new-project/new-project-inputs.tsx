import { useCallback } from "react";
import { Pressable, Text, TextInput, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Folder } from "@/components/icons/material-icons";
import { Switch } from "@/components/ui/switch";
import type { Theme } from "@/styles/theme";

// Inputs for the New project page. Deliberately not the settings form kit: this
// page reads like New workspace — a centred column with one prominent input —
// so the fields wear the composer's surface, not a settings row's.

const ThemedInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

const ThemedFolder = withUnistyles(Folder);
const folderIconMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

interface NewProjectTextInputProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  editable?: boolean;
  autoFocus?: boolean;
  // Renders at the composer's size; secondary fields use the smaller variant.
  prominent?: boolean;
  trailing?: React.ReactNode;
  testID?: string;
}

export function NewProjectTextInput({
  value,
  onChangeText,
  placeholder,
  editable = true,
  autoFocus = false,
  prominent = false,
  trailing,
  testID,
}: NewProjectTextInputProps) {
  return (
    <View style={prominent ? styles.inputBoxProminent : styles.inputBox}>
      <ThemedInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        editable={editable}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        style={prominent ? styles.inputProminent : styles.input}
        testID={testID}
      />
      {trailing}
    </View>
  );
}

// A labelled secondary field. The label is a quiet caption above the input
// rather than a form-kit row, so a stack of them still reads as one column.
export function NewProjectField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

export function NewProjectSwitchRow({
  label,
  value,
  onValueChange,
  disabled,
  testID,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        testID={testID}
      />
    </View>
  );
}

export function NewProjectSuggestionRow({
  path,
  label,
  onSelect,
}: {
  path: string;
  label: string;
  onSelect: (path: string) => void;
}) {
  const handlePress = useCallback(() => onSelect(path), [onSelect, path]);
  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.suggestionRow,
      (Boolean(hovered) || pressed) && styles.suggestionRowActive,
    ],
    [],
  );

  return (
    <Pressable style={rowStyle} onPress={handlePress}>
      <ThemedFolder uniProps={folderIconMapping} />
      <Text style={styles.suggestionText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
  },
  inputBoxProminent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: { xs: theme.fontSize.base, md: theme.fontSize.sm },
    outlineStyle: "none",
  } as object,
  inputProminent: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: { xs: theme.fontSize.lg, md: theme.fontSize.base },
    outlineStyle: "none",
  } as object,
  field: {
    gap: theme.spacing[1.5],
  },
  fieldLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  switchLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: { xs: theme.fontSize.base, md: theme.fontSize.sm },
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  suggestionRowActive: {
    backgroundColor: theme.colors.surface2,
  },
  suggestionText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
