// A hosted preview tab is opened before its dev server is up. This gate holds
// the pane off the host page until the server is ready, and owns the restored
// tab's start flow. The native pane keeps its own copy in index.electron.tsx.
import { useCallback, useEffect, useRef, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useAppSettings } from "@/hooks/use-settings";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { usePreviewRunningServersStore } from "@/stores/preview-running-servers-store";
import { useBrowserStore } from "../store";

interface HostedPreviewGate {
  /** True while the tab must not attach to a host page yet. */
  pending: boolean;
  overlay: ReactElement | null;
}

export function useHostedPreviewGate(input: {
  browserId: string;
  serverId: string;
}): HostedPreviewGate {
  const { browserId, serverId } = input;
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const { settings } = useAppSettings();
  const isPreview = useBrowserStore((state) => state.browsersById[browserId]?.isPreview === true);
  const status = useBrowserStore((state) => state.browsersById[browserId]?.previewStatus);
  const lastError = useBrowserStore((state) => state.browsersById[browserId]?.lastError ?? null);

  const start = useCallback(async () => {
    const { updateBrowser, browsersById } = useBrowserStore.getState();
    const record = browsersById[browserId];
    if (!client || !record?.previewCwd || !record.previewServerName) return;
    updateBrowser(browserId, { previewStatus: "starting", lastError: null });
    try {
      // A server that is already running answers with its url instead of spawning.
      const started = await client.previewStart(record.previewCwd, record.previewServerName);
      if (!started.success || !started.server) {
        updateBrowser(browserId, {
          previewStatus: "error",
          lastError: started.error ?? t("workspace.browser.errors.failedToLoad"),
        });
        return;
      }
      updateBrowser(browserId, {
        url: started.server.url,
        previewServerId: started.server.serverId,
        previewStatus: "ready",
      });
      usePreviewRunningServersStore
        .getState()
        .markRunning(serverId, record.previewCwd, started.server.serverId);
      await client.previewBindTab(started.server.serverId, browserId).catch(() => undefined);
    } catch (cause) {
      updateBrowser(browserId, {
        previewStatus: "error",
        lastError: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [browserId, client, serverId, t]);

  // A restored tab comes back "idle". Bootstrap it once per mount.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current || !isPreview || status !== "idle" || !client || !connected) return;
    bootstrapped.current = true;
    if (settings.previewAutoStartOnRestore) void start();
    else useBrowserStore.getState().updateBrowser(browserId, { previewStatus: "needs-start" });
  }, [browserId, client, connected, isPreview, settings.previewAutoStartOnRestore, start, status]);

  const handleStart = useCallback(() => void start(), [start]);
  const pending = isPreview && status !== "ready";
  if (!pending) return { pending, overlay: null };

  return {
    pending,
    overlay: (
      <View style={styles.overlay}>
        {status === "error" ? (
          <>
            <Text style={styles.title}>{t("workspace.browser.preview.error.title")}</Text>
            {lastError ? (
              <Text style={styles.hint} numberOfLines={4}>
                {lastError}
              </Text>
            ) : null}
            <Button variant="default" size="sm" onPress={handleStart}>
              {t("workspace.browser.preview.error.retry")}
            </Button>
          </>
        ) : null}
        {status === "needs-start" ? (
          <>
            <Text style={styles.title}>{t("workspace.browser.preview.needsStart.title")}</Text>
            <Text style={styles.hint}>{t("workspace.browser.preview.needsStart.description")}</Text>
            <Button variant="default" size="sm" onPress={handleStart}>
              {t("workspace.browser.preview.needsStart.action")}
            </Button>
          </>
        ) : null}
        {status !== "error" && status !== "needs-start" ? (
          <>
            <LoadingSpinner size="small" />
            <Text style={styles.title}>{t("workspace.browser.preview.starting")}</Text>
          </>
        ) : null}
      </View>
    ),
  };
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
