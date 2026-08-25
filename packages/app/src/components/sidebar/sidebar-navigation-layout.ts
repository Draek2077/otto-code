import { StyleSheet, type ViewStyle } from "react-native";

export const SIDEBAR_NAVIGATION_TWO_COLUMN_MIN_WIDTH = 272;

export function shouldUseSingleColumnNavigation(width: number): boolean {
  return width < SIDEBAR_NAVIGATION_TWO_COLUMN_MIN_WIDTH;
}

// Use explicit flex components here instead of the `flex` shorthand. Yoga treats
// `flex: 0` as content-sized, while React Native Web expands it to a zero basis,
// collapsing single-column rows and letting their contents overlap.
export const sidebarNavigationLayoutStyles = StyleSheet.create({
  itemTwoColumn: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
  } satisfies ViewStyle,
  itemSingleColumn: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    alignSelf: "stretch",
  } satisfies ViewStyle,
});
