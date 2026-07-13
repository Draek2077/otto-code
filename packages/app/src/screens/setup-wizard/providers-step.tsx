/**
 * ProvidersStep — wizard step 2. Read-only list of the providers Otto detected
 * on the wizard's host (detection is the daemon's job and already automatic),
 * plus one choice: the primary provider the rest of setup binds to. No auth
 * flows, no enable toggles.
 *
 * The primary-provider pick is lifted to the shell (it will feed the later
 * personality/preset steps). When the snapshot loads and nothing is chosen yet,
 * this auto-selects the first available provider by a fixed preference order.
 *
 * TODO(i18n): inline English, translated in a later pass.
 */

import { useCallback, useEffect, useMemo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProvider, ProviderStatus } from "@otto-code/protocol/agent-types";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { resolveProviderLabel } from "@/utils/provider-definitions";

// Fixed preference order for auto-selecting the primary provider (charter).
// Anything not listed (custom / openai-compatible endpoints) sorts after these.
const PRIMARY_PREFERENCE: readonly string[] = ["claude", "codex", "copilot", "opencode", "pi"];

function preferenceRank(provider: string): number {
  const index = PRIMARY_PREFERENCE.indexOf(provider);
  return index === -1 ? PRIMARY_PREFERENCE.length : index;
}

function statusLabel(status: ProviderStatus, modelCount: number): string {
  switch (status) {
    case "ready":
      return modelCount > 0 ? `Available · ${modelCount} models` : "Available";
    case "loading":
      return "Detecting…";
    case "error":
      return "Error";
    case "unavailable":
      return "Not installed";
  }
}

interface ProvidersStepProps {
  serverId: string | null;
  primaryProvider: AgentProvider | null;
  onSelectPrimary: (provider: AgentProvider) => void;
}

export function ProvidersStep({ serverId, primaryProvider, onSelectPrimary }: ProvidersStepProps) {
  const { entries, isLoading, supportsSnapshot } = useProvidersSnapshot(serverId);

  const sortedEntries = useMemo(() => {
    if (!entries) {
      return [];
    }
    return [...entries].sort((a, b) => preferenceRank(a.provider) - preferenceRank(b.provider));
  }, [entries]);

  const availableProviders = useMemo(
    () => sortedEntries.filter((entry) => entry.status === "ready").map((entry) => entry.provider),
    [sortedEntries],
  );

  // Auto-select the first available provider once, when nothing is chosen yet.
  useEffect(() => {
    if (primaryProvider === null && availableProviders.length > 0) {
      onSelectPrimary(availableProviders[0]);
    }
  }, [primaryProvider, availableProviders, onSelectPrimary]);

  const renderBody = () => {
    if (isLoading || !supportsSnapshot) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>
            {supportsSnapshot ? "Detecting providers…" : "Waiting for the host…"}
          </Text>
        </View>
      );
    }
    if (sortedEntries.length === 0) {
      return (
        <Text style={styles.empty}>
          No providers detected yet. You can still continue and set one up later.
        </Text>
      );
    }
    return (
      <View style={styles.list}>
        {sortedEntries.map((entry) => (
          <ProviderRow
            key={entry.provider}
            provider={entry.provider}
            label={resolveProviderLabel(entry.provider, entries)}
            status={statusLabel(entry.status, entry.models?.length ?? 0)}
            selectable={entry.status === "ready"}
            selected={primaryProvider === entry.provider}
            onSelect={onSelectPrimary}
          />
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Your providers</Text>
        <Text style={styles.subtitle}>
          {availableProviders.length > 0
            ? "Pick the provider your agents should use by default. You can add more later in Settings."
            : "Otto detects your agent providers automatically. You can add one later in Settings."}
        </Text>
      </View>
      {renderBody()}
    </View>
  );
}

function ProviderRow({
  provider,
  label,
  status,
  selectable,
  selected,
  onSelect,
}: {
  provider: AgentProvider;
  label: string;
  status: string;
  selectable: boolean;
  selected: boolean;
  onSelect: (provider: AgentProvider) => void;
}) {
  const handlePress = useCallback(() => onSelect(provider), [onSelect, provider]);
  const rowStyle = useMemo(
    () => [styles.row, selected && styles.rowSelected, !selectable && styles.rowDisabled],
    [selected, selectable],
  );
  const radioStyle = useMemo(() => [styles.radio, selected && styles.radioSelected], [selected]);
  const rowAccessibilityState = useMemo(
    () => ({ selected, disabled: !selectable }),
    [selected, selectable],
  );
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={rowAccessibilityState}
      testID={`setup-provider-${provider}`}
      disabled={!selectable}
      onPress={handlePress}
      style={rowStyle}
    >
      <View style={styles.rowContent}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowStatus}>{status}</Text>
      </View>
      <View style={radioStyle}>{selected ? <View style={styles.radioDot} /> : null}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    gap: theme.spacing[6],
  },
  header: {
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: { xs: theme.fontSize["2xl"] + 2, md: theme.fontSize["2xl"] },
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: -0.4,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: { xs: theme.fontSize.base + 2, md: theme.fontSize.base },
    lineHeight: { xs: 24, md: 22 },
  },
  loading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[6],
  },
  loadingText: {
    color: theme.colors.foregroundMuted,
    fontSize: { xs: theme.fontSize.base + 2, md: theme.fontSize.base },
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: { xs: theme.fontSize.base + 2, md: theme.fontSize.base },
    lineHeight: { xs: 24, md: 22 },
  },
  list: {
    gap: theme.spacing[3],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[4],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  rowSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  rowDisabled: {
    opacity: 0.55,
  },
  rowContent: {
    flex: 1,
    gap: theme.spacing[1],
  },
  rowLabel: {
    color: theme.colors.foreground,
    fontSize: { xs: theme.fontSize.lg + 2, md: theme.fontSize.lg },
    fontWeight: theme.fontWeight.medium,
  },
  rowStatus: {
    color: theme.colors.foregroundMuted,
    fontSize: { xs: theme.fontSize.sm + 2, md: theme.fontSize.sm },
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: theme.borderWidth[2],
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: {
    borderColor: theme.colors.accent,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.accent,
  },
}));
