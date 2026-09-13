import { SettingsButton } from "@/screens/settings-search/controls";
import { SettingsTargetScope, SettingsTargetLabel } from "@/screens/settings-search/target";
import { RefreshCw } from "@/components/icons/material-icons";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { providerUsageCopy } from "./copy";
import { ProviderUsageList } from "./list";
import type { ProviderUsageView } from "./types";

export function ProviderUsageSettingsSection({
  view,
  onRefresh,
}: {
  view: ProviderUsageView;
  onRefresh: () => void;
}) {
  const busy = view.kind === "loading" || (view.kind === "ready" && view.isRefreshing);

  const refreshButton = useMemo(
    () => (
      <SettingsButton
        settingIds={["host-usage-usage-refresh"]}
        variant="ghost"
        size="sm"
        leftIcon={RefreshCw}
        loading={busy}
        onPress={onRefresh}
        accessibilityLabel={providerUsageCopy.refresh}
      >
        {busy ? providerUsageCopy.refreshing : providerUsageCopy.refresh}
      </SettingsButton>
    ),
    [busy, onRefresh],
  );

  return (
    <SettingsSection
      title={providerUsageCopy.title}
      testID="provider-usage-card"
      trailing={refreshButton}
    >
      <ProviderUsageBody view={view} onRefresh={onRefresh} />
    </SettingsSection>
  );
}

function ProviderUsageBody({
  view,
  onRefresh,
}: {
  view: ProviderUsageView;
  onRefresh: () => void;
}) {
  if (view.kind === "loading") {
    return (
      <View style={[settingsStyles.card, styles.emptyCard]}>
        <Text style={styles.emptyText}>{providerUsageCopy.loading}</Text>
      </View>
    );
  }

  if (view.kind === "error") {
    return (
      <Alert variant="error" title={providerUsageCopy.errorTitle} description={view.message}>
        <Button variant="outline" size="sm" onPress={onRefresh}>
          {providerUsageCopy.retry}
        </Button>
      </Alert>
    );
  }

  if (view.payload.providers.length === 0) {
    return (
      <View style={[settingsStyles.card, styles.emptyCard]}>
        <Text style={styles.emptyText}>{providerUsageCopy.empty}</Text>
      </View>
    );
  }

  return (
    <SettingsTargetScope settingIds={["host-usage-usage-provider-usage"]}>
      <ProviderUsageList providers={view.payload.providers} Label={SettingsTargetLabel} />
    </SettingsTargetScope>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));
