import { StyleSheet } from "react-native";
import { describe, expect, it } from "vitest";
import {
  SIDEBAR_NAVIGATION_TWO_COLUMN_MIN_WIDTH,
  shouldUseSingleColumnNavigation,
  sidebarNavigationLayoutStyles,
} from "./sidebar-navigation-layout";

describe("sidebar navigation layout", () => {
  it("switches to one column only below the supported two-column width", () => {
    expect(shouldUseSingleColumnNavigation(SIDEBAR_NAVIGATION_TWO_COLUMN_MIN_WIDTH - 1)).toBe(true);
    expect(shouldUseSingleColumnNavigation(SIDEBAR_NAVIGATION_TWO_COLUMN_MIN_WIDTH)).toBe(false);
  });

  it("keeps single-column rows content-sized on native and web", () => {
    expect(
      StyleSheet.flatten([
        sidebarNavigationLayoutStyles.itemTwoColumn,
        sidebarNavigationLayoutStyles.itemSingleColumn,
      ]),
    ).toMatchObject({
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: "auto",
      alignSelf: "stretch",
    });
  });
});
