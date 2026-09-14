import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@otto-code/protocol/messages";
import type { ProviderOttoToolsPolicy } from "@otto-code/protocol/provider-config";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsTargetText } from "@/screens/settings-search/target";

export function readProviderToolPolicy(config: MutableDaemonConfig | null, provider: string) {
  return config?.providers?.[provider]?.ottoTools;
}

/** Exact provider policy; group selection remains owned by ProviderToolGroupsSection. */
export function ProviderToolPolicySection({
  provider,
  policy,
  supported,
  ready,
  patchConfig,
}: {
  provider: string;
  policy: ProviderOttoToolsPolicy | undefined;
  supported: boolean;
  ready: boolean;
  patchConfig: (patch: MutableDaemonConfigPatch) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const savedNames = (policy?.disabledTools ?? []).join("\n");
  const [names, setNames] = useState(savedNames);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setNames(savedNames);
  }, [savedNames]);

  const save = useCallback(
    async (change: ProviderOttoToolsPolicy) => {
      if (saving || !supported || !ready) return;
      setSaving(true);
      setError(null);
      setSaved(false);
      try {
        // Patch just the changed policy field. The daemon merges sibling fields,
        // so toggling the master switch never discards the explicit deny list.
        const result = await patchConfig({ providers: { [provider]: { ottoTools: change } } });
        if (!result) throw new Error(t("settings.providers.tools.policy.unavailable"));
        setSaved(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("settings.providers.tools.saveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [patchConfig, provider, ready, saving, supported, t],
  );

  const handleEnabledChange = useCallback(
    (enabled: boolean) => {
      void save({ enabled });
    },
    [save],
  );
  const handleNamesChange = useCallback((value: string) => {
    setNames(value);
    setSaved(false);
  }, []);
  const handleSaveNames = useCallback(() => {
    void save({
      disabledTools: [
        ...new Set(
          names
            .split(/\r?\n/)
            .map((name) => name.trim())
            .filter(Boolean),
        ),
      ],
    });
  }, [names, save]);

  const disabled = !ready || saving;
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <SettingsTargetText settingId="host-providers-tools-enable-otto-tools" style={styles.label}>
          {t("settings.providers.tools.policy.enabled")}
        </SettingsTargetText>
        {supported ? (
          <Switch
            testID="provider-otto-tools-enabled"
            accessibilityLabel={t("settings.providers.tools.policy.enabled")}
            value={policy?.enabled !== false}
            disabled={disabled}
            onValueChange={handleEnabledChange}
          />
        ) : null}
      </View>
      <Text style={styles.hint}>{t("settings.providers.tools.policy.description")}</Text>
      <SettingsTargetText settingId="host-providers-tools-disabled-tools" style={styles.label}>
        {t("settings.providers.tools.policy.disabledTools")}
      </SettingsTargetText>
      {supported ? (
        <>
          <Text style={styles.hint}>{t("settings.providers.tools.policy.namesHint")}</Text>
          <AdaptiveTextInput
            testID="provider-disabled-tools"
            accessibilityLabel={t("settings.providers.tools.policy.disabledTools")}
            style={styles.input}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            initialValue={savedNames}
            resetKey={savedNames}
            editable={!disabled}
            onChangeText={handleNamesChange}
          />
          <View style={styles.actions}>
            <Button
              testID="provider-tool-policy-save"
              size="sm"
              variant="secondary"
              disabled={disabled || names === savedNames}
              loading={saving}
              onPress={handleSaveNames}
            >
              {t("settings.providers.tools.policy.save")}
            </Button>
          </View>
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          {saved ? (
            <Text accessibilityLiveRegion="polite" style={styles.hint}>
              {t("settings.providers.tools.saved")}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.hint}>{t("settings.providers.tools.policy.updateHost")}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    marginBottom: theme.spacing[4],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  label: {
    flexShrink: 1,
    flexGrow: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  input: {
    minHeight: 96,
    padding: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
    textAlignVertical: "top",
  },
  actions: { alignItems: "flex-end" },
  error: { fontSize: theme.fontSize.sm, color: theme.colors.destructive },
}));
