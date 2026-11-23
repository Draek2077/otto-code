import { StyleSheet } from "react-native-unistyles";

/** The Explorer dock's shared tab track follows its owning sidebar surface. */
export const explorerChrome = StyleSheet.create((theme) => ({
  tabs: { backgroundColor: theme.colors.surfaceSidebar },
}));
