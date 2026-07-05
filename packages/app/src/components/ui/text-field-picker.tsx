import { useCallback, useRef, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ChevronDown } from "lucide-react-native";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";

export type { ComboboxOption } from "@/components/ui/combobox";

interface TextFieldPickerProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder: string;
  testID?: string;
}

/**
 * A settings-form text field that offers a list of known-good values (e.g. a
 * base URL, model ID, or shell command) while still accepting any freeform
 * value via the Combobox's `allowCustomValue` option — so a documented preset
 * doesn't lock the user out of an undocumented one.
 */
export function TextFieldPicker({
  value,
  onChange,
  options,
  placeholder,
  testID,
}: TextFieldPickerProps) {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback(
    (id: string) => {
      onChange(id);
      setOpen(false);
    },
    [onChange],
  );

  const handlePress = useCallback(() => {
    setOpen((current) => !current);
  }, []);

  const triggerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.trigger,
      (Boolean(hovered) || pressed || open) && styles.triggerActive,
    ],
    [open],
  );

  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          onPress={handlePress}
          style={triggerStyle}
          accessibilityRole="button"
          testID={testID}
        >
          <Text style={value ? styles.triggerText : styles.triggerPlaceholder} numberOfLines={1}>
            {value || placeholder}
          </Text>
          <ChevronDown size={16} color={styles.chevron.color} />
        </Pressable>
      </View>
      <Combobox
        options={options}
        value={value}
        onSelect={handleSelect}
        searchable
        allowCustomValue
        customValuePrefix=""
        searchPlaceholder={placeholder}
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  triggerActive: {
    borderColor: theme.colors.borderAccent,
  },
  triggerText: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  triggerPlaceholder: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  chevron: {
    color: theme.colors.foregroundMuted,
  },
}));
