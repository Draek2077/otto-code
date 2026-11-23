/** Otto sidebar seam: null plugin contributions must not leave empty footer chrome. */
import { useCallback, useState, type ReactNode, type RefObject } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SidebarSeparator } from "@/components/sidebar/sidebar-separator";

export function OttoSidebarFooterContent({
  children,
  rowsRef,
  knownContent,
}: {
  children: ReactNode;
  rowsRef: RefObject<View | null>;
  knownContent: boolean;
}) {
  const [hasRenderedRows, setHasRenderedRows] = useState(false);
  const onRowsLayout = useCallback((event: LayoutChangeEvent) => {
    setHasRenderedRows(event.nativeEvent.layout.height > 0);
  }, []);
  const hasContent = knownContent || hasRenderedRows;
  return (
    <>
      <View style={hasContent ? styles.spacing : undefined}>
        <View ref={rowsRef} collapsable={false} style={styles.rows} onLayout={onRowsLayout}>
          {children}
        </View>
      </View>
      {hasContent ? <SidebarSeparator testID="sidebar-footer-separator" /> : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  spacing: { paddingVertical: theme.spacing[1.5] },
  rows: { paddingHorizontal: theme.spacing[2], gap: 2 },
}));
