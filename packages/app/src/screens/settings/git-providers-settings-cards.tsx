import { useCallback, useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { StyleSheet } from "react-native-unistyles";
import type { HostingAuthStatusPayload } from "@otto-code/client";
import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/icons/github-icon";
import { BitbucketIcon } from "@/components/icons/bitbucket-icon";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";

/**
 * The single detection point for the git hosting providers capability.
 * COMPAT(gitHostingProviders): added in v0.4.5, drop the gate when daemon floor >= v0.4.5.
 */
export function useGitProvidersFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.gitHostingProviders === true,
  );
}

// Host-level git hosting providers: credentials are configured once per host,
// and each workspace uses whichever provider its git remote points at
// (bitbucket.org → Bitbucket, github.com → GitHub).
export function GitProvidersSettingsCards({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const hasFeature = useGitProvidersFeature(serverId);

  if (!hasFeature) {
    return (
      <View style={settingsStyles.card} testID="git-providers-update-host-card">
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowHint}>{t("settings.host.gitProviders.updateHost")}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <>
      <GitHubProviderCard serverId={serverId} />
      <BitbucketCloudProviderCard serverId={serverId} />
    </>
  );
}

function GitHubProviderCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);

  const authStatusMutation = useMutation({
    mutationFn: async (): Promise<HostingAuthStatusPayload> => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return client.getHostingAuthStatus({ provider: "github" });
    },
  });
  const handleCheck = useCallback(() => {
    authStatusMutation.mutate();
  }, [authStatusMutation]);

  return (
    <View style={settingsStyles.card} testID="git-providers-github-card">
      <View style={settingsStyles.row}>
        <View style={styles.providerHeading}>
          <GitHubIcon size={20} color={styles.iconColor.color} />
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.host.gitProviders.github.name")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.host.gitProviders.github.hint")}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.borderedRow}>
        <View style={settingsStyles.rowContent}>
          {renderAuthStatus({
            t,
            isChecking: authStatusMutation.isPending,
            authStatus: authStatusMutation.data ?? null,
            idleHint: t("settings.host.gitProviders.github.idle"),
          })}
        </View>
        <Button
          testID="git-providers-github-check-button"
          onPress={handleCheck}
          variant="secondary"
          size="sm"
          disabled={!client || authStatusMutation.isPending}
        >
          {t("settings.host.gitProviders.checkConnection")}
        </Button>
      </View>
    </View>
  );
}

function BitbucketCloudProviderCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const persisted = config?.gitHosting?.providers?.bitbucketCloud;
  const persistedEmail = persisted?.email ?? "";
  const persistedToken = persisted?.apiToken ?? "";

  const [emailDraft, setEmailDraft] = useState(persistedEmail);
  const [tokenDraft, setTokenDraft] = useState(persistedToken);

  // Resync from the committed values when they change elsewhere.
  useEffect(() => {
    setEmailDraft(persistedEmail);
  }, [persistedEmail]);
  useEffect(() => {
    setTokenDraft(persistedToken);
  }, [persistedToken]);

  const credentialsMutation = useMutation({
    mutationFn: async (next: { email?: string; apiToken?: string }) => {
      const result = await patchConfig({
        gitHosting: { providers: { bitbucketCloud: next } },
      });
      if (!result) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return result;
    },
  });

  const commitEmail = useCallback(() => {
    const next = emailDraft.trim();
    if (next === persistedEmail.trim()) return;
    credentialsMutation.mutate({ email: next });
  }, [emailDraft, persistedEmail, credentialsMutation]);

  const commitToken = useCallback(() => {
    const next = tokenDraft.trim();
    if (next === persistedToken.trim()) return;
    credentialsMutation.mutate({ apiToken: next });
  }, [tokenDraft, persistedToken, credentialsMutation]);

  const authStatusMutation = useMutation({
    mutationFn: async (): Promise<HostingAuthStatusPayload> => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return client.getHostingAuthStatus({ provider: "bitbucket-cloud" });
    },
  });
  const handleCheck = useCallback(() => {
    authStatusMutation.mutate();
  }, [authStatusMutation]);

  const hasCredentials = persistedEmail.trim().length > 0 && persistedToken.trim().length > 0;
  const idleHint = hasCredentials
    ? t("settings.host.gitProviders.bitbucket.readyToCheck")
    : t("settings.host.gitProviders.bitbucket.missingCredentials");
  const statusContent = credentialsMutation.isError
    ? renderSaveError(t)
    : renderAuthStatus({
        t,
        isChecking: authStatusMutation.isPending,
        authStatus: authStatusMutation.data ?? null,
        idleHint,
      });

  return (
    <View style={settingsStyles.card} testID="git-providers-bitbucket-card">
      <View style={settingsStyles.row}>
        <View style={styles.providerHeading}>
          <BitbucketIcon size={20} color={styles.iconColor.color} />
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.host.gitProviders.bitbucket.name")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.host.gitProviders.bitbucket.hint")}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.borderedRow}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.host.gitProviders.bitbucket.email")}
          </Text>
        </View>
        <TextInput
          value={emailDraft}
          onChangeText={setEmailDraft}
          onBlur={commitEmail}
          onSubmitEditing={commitEmail}
          placeholder="you@company.com"
          placeholderTextColor={styles.placeholderColor.color}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          inputMode="email"
          style={styles.credentialInput}
          accessibilityLabel={t("settings.host.gitProviders.bitbucket.email")}
          testID="git-providers-bitbucket-email-input"
        />
      </View>
      <View style={styles.borderedRow}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.host.gitProviders.bitbucket.apiToken")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {t("settings.host.gitProviders.bitbucket.apiTokenHint")}
          </Text>
        </View>
        <TextInput
          value={tokenDraft}
          onChangeText={setTokenDraft}
          onBlur={commitToken}
          onSubmitEditing={commitToken}
          placeholder={t("settings.host.gitProviders.bitbucket.apiTokenPlaceholder")}
          placeholderTextColor={styles.placeholderColor.color}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={styles.credentialInput}
          accessibilityLabel={t("settings.host.gitProviders.bitbucket.apiToken")}
          testID="git-providers-bitbucket-token-input"
        />
      </View>
      <View style={styles.borderedRow}>
        <View style={settingsStyles.rowContent}>{statusContent}</View>
        <Button
          testID="git-providers-bitbucket-check-button"
          onPress={handleCheck}
          variant="secondary"
          size="sm"
          disabled={!client || !hasCredentials || authStatusMutation.isPending}
        >
          {t("settings.host.gitProviders.checkConnection")}
        </Button>
      </View>
    </View>
  );
}

function renderSaveError(t: TFunction) {
  return (
    <Text style={settingsStyles.rowError} testID="git-providers-credentials-error">
      {t("settings.host.gitProviders.bitbucket.saveError")}
    </Text>
  );
}

function renderAuthStatus(params: {
  t: TFunction;
  isChecking: boolean;
  authStatus: HostingAuthStatusPayload | null;
  idleHint: string;
}) {
  const { t, isChecking, authStatus, idleHint } = params;
  if (isChecking) {
    return <Text style={settingsStyles.rowHint}>{t("settings.host.gitProviders.checking")}</Text>;
  }
  if (authStatus) {
    if (authStatus.authenticated) {
      return (
        <Text style={styles.statusOk} testID="git-providers-auth-ok">
          {t("settings.host.gitProviders.connected")}
        </Text>
      );
    }
    return (
      <Text style={settingsStyles.rowError} testID="git-providers-auth-failed">
        {authStatus.error ?? t("settings.host.gitProviders.connectionFailed")}
      </Text>
    );
  }
  return <Text style={settingsStyles.rowHint}>{idleHint}</Text>;
}

const styles = StyleSheet.create((theme) => ({
  providerHeading: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  iconColor: {
    color: theme.colors.foreground,
  },
  // settingsStyles.row plus a top separator, flattened into one style so JSX
  // never allocates a fresh style array per render.
  borderedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  credentialInput: {
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: 280,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "left",
  },
  placeholderColor: {
    color: theme.colors.foregroundMuted,
  },
  statusOk: {
    color: theme.colors.success,
    fontSize: theme.fontSize.sm,
  },
}));
