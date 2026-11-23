import { useCallback, useState, type ReactNode, type Ref } from "react";
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { sidebarShortcutColumns } from "./navigation-layout";

export function SidebarShortcutGrid({
  items,
  trailing,
  groupRef,
  style,
}: {
  items: readonly { key: string; content: ReactNode }[];
  trailing?: ReactNode;
  groupRef: Ref<View>;
  style?: StyleProp<ViewStyle>;
}) {
  const [columns, setColumns] = useState<1 | 2>(1);
  const measure = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    // Hidden retained panels do not choose the visible sidebar's responsive layout.
    if (width > 0) setColumns(sidebarShortcutColumns(width));
  }, []);
  return (
    <View ref={groupRef} collapsable={false} style={style} testID="sidebar-shortcuts">
      <View style={styles.row}>
        <View style={styles.grid} onLayout={measure} testID="sidebar-shortcuts-grid">
          {items.map((item) => (
            <View key={item.key} style={columns === 2 ? styles.half : styles.full}>
              {item.content}
            </View>
          ))}
        </View>
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  grid: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", rowGap: 2 },
  half: { width: "50%", flexGrow: 0, flexShrink: 0, minWidth: 0 },
  full: { width: "100%", flexGrow: 0, flexShrink: 0, minWidth: 0 },
  trailing: { flexShrink: 0 },
});
