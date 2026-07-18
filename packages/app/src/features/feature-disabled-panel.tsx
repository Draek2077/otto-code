import { useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { FEATURE_CATALOG, type FeatureId } from "@/features/feature-catalog";
import { useAppSettings } from "@/hooks/use-settings";

// Rendered in place of a disabled feature's panel. This is the safety net for a
// persisted tab that renders in the instant before the reaper closes it (and
// for any host where the reaper isn't mounted): it never references the feature's
// lazy panel, so the heavy module is never import()-ed while disabled. Raw
// English, matching the developer-mode-only settings surfaces this pairs with.
export function FeatureDisabledPanel({ featureId }: { featureId: FeatureId }) {
  const feature = FEATURE_CATALOG[featureId];
  const { settings, updateSettings } = useAppSettings();
  const handleEnable = useCallback(() => {
    void updateSettings({
      featureEnabled: { ...settings.featureEnabled, [featureId]: true },
    });
  }, [featureId, settings.featureEnabled, updateSettings]);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>{feature.label} is turned off</Text>
        <Text style={styles.body}>
          This feature is disabled in Settings, so its code isn&apos;t loaded. Turn it back on to
          use it.
        </Text>
        <Button variant="secondary" size="sm" onPress={handleEnable} style={styles.button}>
          {`Enable ${feature.label}`}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
    padding: theme.spacing[6],
  },
  content: {
    maxWidth: 360,
    gap: theme.spacing[3],
    alignItems: "center",
  },
  title: {
    fontSize: theme.fontSize.lg,
    fontWeight: "600",
    color: theme.colors.foreground,
    textAlign: "center",
  },
  body: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  button: {
    marginTop: theme.spacing[2],
  },
}));
