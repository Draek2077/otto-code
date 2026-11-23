import { Suspense, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsRow } from "@/components/settings";

const loadingDocument = <SettingsRow label="Opening Knowledge document..." />;

/** Keep the project catalog beside the document on desktop; compact keeps its drill-down. */
export function KnowledgeReadingLayout({
  compact,
  detailOpen,
  catalog,
  detail,
}: {
  compact: boolean;
  detailOpen: boolean;
  catalog: ReactNode;
  detail: ReactNode;
}) {
  const reading = <Suspense fallback={loadingDocument}>{detail}</Suspense>;
  if (compact)
    return (
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        {detailOpen ? reading : catalog}
      </ScrollView>
    );
  return (
    <View style={styles.columns}>
      <ScrollView
        style={styles.catalog}
        contentContainerStyle={styles.catalogContent}
        testID="knowledge-catalog-pane"
      >
        {catalog}
      </ScrollView>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        testID="knowledge-document-pane"
      >
        {reading}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, minWidth: 0, minHeight: 0 },
  columns: { flex: 1, minWidth: 0, minHeight: 0, flexDirection: "row" },
  catalog: {
    width: 320,
    maxWidth: "40%",
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  catalogContent: { padding: theme.spacing[4], gap: theme.spacing[3] },
  content: {
    width: "100%",
    maxWidth: 840,
    alignSelf: "center",
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[8],
  },
}));
