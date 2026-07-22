import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

// Native fallback for the graph designer (projects/orchestration-graphs): the
// Drawflow canvas is a DOM editor (the CM6 precedent), and designing a graph
// wants a desktop-sized screen anyway. Running an existing graph works from
// any device via the New Orchestration dialog — only authoring is web/desktop.
export function OrchestrationGraphPanel(): ReactElement {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Graph designer</Text>
      <Text style={styles.body}>
        Designing orchestration graphs needs a desktop-sized screen. Open Otto on the web or the
        desktop app to edit this graph — running it works right here via New Orchestration.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
    backgroundColor: theme.colors.background,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  body: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.5),
    textAlign: "center",
    maxWidth: 420,
  },
}));
