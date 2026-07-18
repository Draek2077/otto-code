import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

/**
 * A pipe (|) that separates logical groups of controls within a horizontal
 * toolbar — e.g. "modify" vs "navigate" buttons in the editor toolbar, or
 * "panels" vs "presentation" toggles in the visualizer toolbar. Purely
 * decorative (hidden from assistive tech); reach for it instead of hand-rolling
 * per-toolbar spacers so every toolbar groups its options the same way.
 *
 * This is the vertical, in-row counterpart to the horizontal SidebarSeparator /
 * DropdownMenuSeparator. Place it as a sibling between two button clusters; the
 * parent row's `gap` handles the breathing room around it.
 */
export function ToolbarSeparator() {
  return (
    <View style={styles.slot} aria-hidden>
      <Text style={styles.pipe} selectable={false}>
        {"|"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  slot: {
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    paddingHorizontal: theme.spacing[1],
  },
  pipe: {
    // Match the UI separator-line token so the pipe reads with the same
    // weight as SidebarSeparator / toolbar borders across every theme.
    color: theme.colors.border,
    fontSize: theme.fontSize.sm - 1,
    lineHeight: theme.fontSize.sm - 1,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
}));
