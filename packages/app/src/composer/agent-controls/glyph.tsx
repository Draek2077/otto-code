import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { COMPOSER_ICON_SIZE } from "@/composer/composer-icon-size";

/**
 * The fixed box a composer toolbar glyph is centred in, so every control reserves the
 * same width whatever it draws.
 *
 * The box is sized from the same token as the glyph inside it. It used to carry its own
 * 16/20 pixel ladder, which silently disagreed with the glyph once the compact ramp
 * moved.
 */
export function ComposerToolbarGlyph({ children }: { children: ReactNode }) {
  return (
    <View
      style={styles.box}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    width: theme.iconSize[COMPOSER_ICON_SIZE],
    height: theme.iconSize[COMPOSER_ICON_SIZE],
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
}));
