import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  ArrowUpRight,
  Terminal,
  Check,
  ChevronDown,
  SpeakerNotes,
} from "@/components/icons/material-icons";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getDesktopHost } from "@/desktop/host";
import { supportsZoomRecorder } from "@/desktop/zoom-recorder-capability";
import { useZoomRecorderStatus } from "@/desktop/use-zoom-recorder-status";
import { useAppSettings } from "@/hooks/use-settings";
import type { MeetingTranscriptDeliveryPolicy } from "@/hooks/use-settings/storage";
import { ZoomTeamChatSection } from "@/screens/settings/zoom-team-chat-section";
import { openLink } from "@/utils/open-link";
import { confirmDialog } from "@/utils/confirm-dialog";
import { shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { useCliInstall } from "@/desktop/hooks/use-install-status";

const CLI_DOCS_URL = "https://otto-code.me/docs/cli";
const ROW_RESPONSIVE_WITH_BORDER_STYLE = [settingsStyles.rowResponsive, settingsStyles.rowBorder];

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

/** The command-line launcher is a primary integration, paired with Agent skills. */
export function CommandLineIntegrationSection() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const showSection = shouldUseDesktopDaemon();
  const {
    status: cliStatus,
    isInstalling: isInstallingCli,
    install: installCli,
    refresh: refreshCliStatus,
  } = useCliInstall();

  useFocusEffect(
    useCallback(() => {
      if (!showSection) return undefined;
      refreshCliStatus();
      return undefined;
    }, [refreshCliStatus, showSection]),
  );

  const handleInstallCli = useCallback(() => {
    if (isInstallingCli) return;
    installCli();
  }, [installCli, isInstallingCli]);

  const handleOpenCliDocs = useCallback(() => {
    void openLink(CLI_DOCS_URL);
  }, []);

  const arrowIcon = useMemo(
    () => <ArrowUpRight size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
    [theme.iconSize.sm, theme.colors.foregroundMuted],
  );

  if (!showSection) return null;

  return (
    <SettingsSection title={t("settings.integrations.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.rowResponsive}>
          <View style={settingsStyles.rowContent}>
            <View style={styles.rowTitleRow}>
              <Terminal size={theme.iconSize.md} color={theme.colors.foreground} />
              <Text style={settingsStyles.rowTitle}>
                {t("settings.integrations.commandLine.title")}
              </Text>
            </View>
            <Text style={settingsStyles.rowHint}>
              {t("settings.integrations.commandLine.description")}
            </Text>
          </View>
          {cliStatus?.installed ? (
            <View style={styles.installedLabel}>
              <Check size={14} color={theme.colors.foregroundMuted} />
              <Text style={styles.mutedText}>{t("settings.integrations.actions.installed")}</Text>
            </View>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onPress={handleInstallCli}
              disabled={isInstallingCli}
            >
              {isInstallingCli
                ? t("settings.integrations.actions.installing")
                : t("settings.integrations.actions.install")}
            </Button>
          )}
        </View>
      </View>
      <View style={styles.docsFooter}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={arrowIcon}
          textStyle={settingsStyles.sectionHeaderLinkText}
          style={settingsStyles.sectionHeaderLink}
          onPress={handleOpenCliDocs}
          accessibilityLabel={t("settings.integrations.docs.openCli")}
        >
          {t("settings.integrations.docs.cli")}
        </Button>
      </View>
    </SettingsSection>
  );
}

// oxlint-disable-next-line complexity -- one settings section coordinates desktop integrations and their explicit states.
export function IntegrationsSection(props: { serverId: string | null; isLocalDaemon: boolean }) {
  const { serverId, isLocalDaemon } = props;
  const { theme } = useUnistyles();
  const showZoomRecorder = supportsZoomRecorder(getDesktopHost());
  const { settings: appSettings, updateSettings: updateAppSettings } = useAppSettings();
  const { status: zoomRecorderStatus, refresh: refreshZoomRecorderStatus } =
    useZoomRecorderStatus();
  const [isChangingZoomRecorder, setIsChangingZoomRecorder] = useState(false);
  const [meetingAdapter, setMeetingAdapter] = useState<"zoom">("zoom");
  const selectZoomMeetingAdapter = useCallback(() => setMeetingAdapter("zoom"), []);
  const handleZoomRecorderChange = useCallback(
    async (zoomRecorderEnabled: boolean) => {
      if (isChangingZoomRecorder) return;
      setIsChangingZoomRecorder(true);
      try {
        await updateAppSettings({ zoomRecorderEnabled, zoomRecorderPaused: false });
        const recorder = getDesktopHost()?.zoomRecorder;
        if (zoomRecorderEnabled) await recorder?.enable?.();
        else await recorder?.disable?.();
        await refreshZoomRecorderStatus();
      } catch (error) {
        console.warn("[ZoomRecorder] Failed to change enabled state", error);
      } finally {
        setIsChangingZoomRecorder(false);
      }
    },
    [isChangingZoomRecorder, refreshZoomRecorderStatus, updateAppSettings],
  );

  const handleDeleteZoomRecorderModel = useCallback(async () => {
    if (isChangingZoomRecorder) return;
    const confirmed = await confirmDialog({
      title: "Delete meeting transcription model?",
      message:
        "This removes the downloaded local speech recognition model and frees its disk space. Meeting transcription will download it again when you enable the feature.",
      confirmLabel: "Delete model",
      destructive: true,
    });
    if (!confirmed) return;
    setIsChangingZoomRecorder(true);
    try {
      await updateAppSettings({ zoomRecorderEnabled: false, zoomRecorderPaused: false });
      await getDesktopHost()?.zoomRecorder?.deleteModel?.();
      await refreshZoomRecorderStatus();
    } catch (error) {
      console.warn("[ZoomRecorder] Failed to delete local model", error);
    } finally {
      setIsChangingZoomRecorder(false);
    }
  }, [isChangingZoomRecorder, refreshZoomRecorderStatus, updateAppSettings]);

  const onZoomRecorderSwitchChange = useCallback(
    (value: boolean) => {
      void handleZoomRecorderChange(value);
    },
    [handleZoomRecorderChange],
  );

  const onDeleteZoomRecorderModel = useCallback(() => {
    void handleDeleteZoomRecorderModel();
  }, [handleDeleteZoomRecorderModel]);

  const changeMeetingTranscriptDeliveryPolicy = useCallback(
    (meetingTranscriptDeliveryPolicy: MeetingTranscriptDeliveryPolicy) => {
      void updateAppSettings({ meetingTranscriptDeliveryPolicy });
    },
    [updateAppSettings],
  );
  const useLocalMeetingTranscriptDelivery = useCallback(() => {
    changeMeetingTranscriptDeliveryPolicy("local_only");
  }, [changeMeetingTranscriptDeliveryPolicy]);
  const requireSecureMeetingTranscriptDelivery = useCallback(() => {
    changeMeetingTranscriptDeliveryPolicy("require_secure_connection");
  }, [changeMeetingTranscriptDeliveryPolicy]);
  const useCurrentMeetingTranscriptConnection = useCallback(() => {
    changeMeetingTranscriptDeliveryPolicy("current_connection");
  }, [changeMeetingTranscriptDeliveryPolicy]);

  const zoomRecorderModelHint = useMemo(() => {
    if (zoomRecorderStatus.state === "setup") {
      return `${zoomRecorderStatus.detail} ${formatBytes(zoomRecorderStatus.modelBytes)} downloaded.`;
    }
    if (zoomRecorderStatus.modelReady) {
      return `${zoomRecorderStatus.detail} Using ${formatBytes(zoomRecorderStatus.modelBytes)} on this computer.`;
    }
    return zoomRecorderStatus.detail;
  }, [
    zoomRecorderStatus.detail,
    zoomRecorderStatus.modelBytes,
    zoomRecorderStatus.modelReady,
    zoomRecorderStatus.state,
  ]);

  const meetingTranscriptDeliveryHint = useMemo(() => {
    if (appSettings.meetingTranscriptDeliveryPolicy === "local_only") {
      return "Transcript text stays on this desktop and is never uploaded to a daemon.";
    }
    if (appSettings.meetingTranscriptDeliveryPolicy === "current_connection") {
      return "Transcript text uses the current Otto connection, which may not be encrypted.";
    }
    return "Transcript text is delivered only through verified TLS/WSS. Otherwise it waits locally.";
  }, [appSettings.meetingTranscriptDeliveryPolicy]);

  return (
    <>
      <ZoomTeamChatSection serverId={serverId} isLocalDaemon={isLocalDaemon} />
      {showZoomRecorder ? (
        <SettingsSection title="Meetings">
          <View style={settingsStyles.card}>
            <View style={settingsStyles.rowResponsive}>
              <View style={settingsStyles.rowContent}>
                <View style={styles.rowTitleRow}>
                  <SpeakerNotes size={theme.iconSize.md} color={theme.colors.foreground} />
                  <Text style={settingsStyles.rowTitle}>Meeting transcription</Text>
                </View>
                <Text style={settingsStyles.rowHint}>
                  Transcribe meetings locally on this computer and show its title-bar control.
                </Text>
              </View>
              <Switch
                value={appSettings.zoomRecorderEnabled}
                onValueChange={onZoomRecorderSwitchChange}
                disabled={isChangingZoomRecorder}
                accessibilityLabel="Enable meeting transcription"
                testID="zoom-recorder-enabled-switch"
              />
            </View>
            <>
              <View style={ROW_RESPONSIVE_WITH_BORDER_STYLE}>
                <View style={settingsStyles.rowContent}>
                  <Text style={settingsStyles.rowTitle}>Transcript delivery</Text>
                  <Text style={settingsStyles.rowHint}>{meetingTranscriptDeliveryHint}</Text>
                </View>
                <View style={ACTIONS_ROW_STYLE}>
                  <Button
                    variant={
                      appSettings.meetingTranscriptDeliveryPolicy === "local_only"
                        ? "secondary"
                        : "outline"
                    }
                    size="sm"
                    onPress={useLocalMeetingTranscriptDelivery}
                  >
                    Desktop only
                  </Button>
                  <Button
                    variant={
                      appSettings.meetingTranscriptDeliveryPolicy === "require_secure_connection"
                        ? "secondary"
                        : "outline"
                    }
                    size="sm"
                    onPress={requireSecureMeetingTranscriptDelivery}
                  >
                    TLS/WSS
                  </Button>
                  <Button
                    variant={
                      appSettings.meetingTranscriptDeliveryPolicy === "current_connection"
                        ? "secondary"
                        : "outline"
                    }
                    size="sm"
                    onPress={useCurrentMeetingTranscriptConnection}
                  >
                    Use current
                  </Button>
                </View>
              </View>
              <View style={ROW_RESPONSIVE_WITH_BORDER_STYLE}>
                <View style={settingsStyles.rowContent}>
                  <Text style={settingsStyles.rowTitle}>Local speech recognition model</Text>
                  <Text style={settingsStyles.rowHint}>{zoomRecorderModelHint}</Text>
                </View>
                <View style={ACTIONS_ROW_STYLE}>
                  {zoomRecorderStatus.state === "setup" ? (
                    <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
                  ) : null}
                  {zoomRecorderStatus.modelBytes > 0 || zoomRecorderStatus.modelReady ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onPress={onDeleteZoomRecorderModel}
                      disabled={isChangingZoomRecorder}
                    >
                      Delete model
                    </Button>
                  ) : null}
                </View>
              </View>
            </>
            <View style={ROW_RESPONSIVE_WITH_BORDER_STYLE}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>Adapter</Text>
              </View>
              <DropdownMenu>
                <DropdownMenuTrigger
                  style={styles.adapterTrigger}
                  accessibilityLabel={`Meeting transcription adapter: ${meetingAdapter === "zoom" ? "Zoom" : meetingAdapter}`}
                  testID="meeting-adapter-picker"
                >
                  <Text style={styles.adapterTriggerText}>Zoom</Text>
                  <ChevronDown size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="end" width={180}>
                  <DropdownMenuItem
                    selected={meetingAdapter === "zoom"}
                    onSelect={selectZoomMeetingAdapter}
                  >
                    Zoom
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </View>
          </View>
        </SettingsSection>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  docsFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  rowTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  installedLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actionsRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  adapterTrigger: {
    alignItems: "center",
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    flexDirection: "row",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  adapterTriggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));

const ACTIONS_ROW_STYLE = [styles.actionsRow, settingsStyles.rowControlGroup];
