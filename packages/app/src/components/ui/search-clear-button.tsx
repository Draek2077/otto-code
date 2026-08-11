import { useCallback, type ReactElement } from "react";
import { Pressable, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { X } from "@/components/icons/material-icons";

const ThemedX = withUnistyles(X, (theme) => ({
  color: theme.colors.foregroundMuted,
  size: 16,
}));

/** A consistent, right-pinned clear affordance for populated search fields. */
export function SearchClearButton({
  onPress,
  label = "Clear search",
  testID,
}: {
  onPress: () => void;
  label?: string;
  testID?: string;
}): ReactElement {
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.button,
      (hovered || pressed) && styles.buttonActive,
    ],
    [],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={buttonStyle}
      testID={testID}
    >
      <ThemedX />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
  },
  buttonActive: { backgroundColor: theme.colors.surfaceHover },
}));
