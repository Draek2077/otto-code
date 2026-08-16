import { useCallback, type ReactElement } from "react";
import { TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Search } from "@/components/icons/material-icons";
import { isWeb } from "@/constants/platform";
import { SearchClearButton } from "./search-clear-button";

const ThemedSearch = withUnistyles(Search);
const ThemedSearchInput = withUnistyles(TextInput);
const searchIconProps = (theme: {
  colors: { foregroundMuted: string };
  iconSize: { md: number };
}) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.md,
});
const searchInputProps = (theme: { colors: { foregroundMuted: string } }) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
});

/** Shared search chrome for the Zoom title-bar popups. */
export function TitlebarPopupSearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  accessibilityLabel: string;
}): ReactElement {
  const clear = useCallback(() => onChangeText(""), [onChangeText]);
  return (
    <View style={styles.searchField}>
      <ThemedSearch uniProps={searchIconProps} />
      <ThemedSearchInput
        autoFocus
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        accessibilityLabel={accessibilityLabel}
        // @ts-expect-error - outlineStyle is web-only
        style={[styles.searchInput, isWeb && { outlineStyle: "none" }]}
        uniProps={searchInputProps}
      />
      {value.length > 0 ? <SearchClearButton onPress={clear} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  searchField: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 36,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.borderAccent,
    paddingHorizontal: theme.spacing[3],
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[1],
  },
}));
