import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { LoadingSpinner } from "./loading-spinner";

/** Full-tab loading state used while a page has no coherent data to render. */
export function PageLoading({ label, testID }: { label: string; testID?: string }): ReactElement {
  return (
    <View style={styles.root} testID={testID}>
      <LoadingSpinner size="small" />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[6],
    backgroundColor: theme.colors.surface0,
  },
  label: { color: theme.colors.mutedForeground, fontSize: theme.fontSize.sm },
}));
