import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { NumberStepperField } from "@/components/ui/number-stepper-field";
import { useFetchQuery } from "@/data/query";
import { clearPreviewAttachments, readAttachmentStoreUsage } from "@/attachments/service";
import { EMPTY_ATTACHMENT_STORE_USAGE, type AttachmentStoreUsage } from "@/attachments/types";
import { useToast } from "@/contexts/toast-context";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { formatFileSize } from "@/utils/format-file-size";
import { SettingsSection } from "./settings-section";

/**
 * Daemon → Storage. What the agents on this host have accumulated, and the way
 * to get it back.
 *
 * Two rows because there are two stores with two different owners, and telling
 * a user "images: 812 MB" when half of it is a cache they cannot lose and half
 * is a record they can would be a readout that means nothing:
 *
 * - **Images on the host** - the daemon's `$OTTO_HOME/attachments`. The record
 *   a transcript's markdown points at. Clearing it degrades old messages to alt
 *   text, permanently, so it goes through a dry run and a destructive confirm.
 * - **Cached previews** - this device's local copies. Regenerable from the row
 *   above, so clearing is a plain action with no confirmation theatre.
 *
 * Sent attachments are a third tier and deliberately absent: they are the
 * user's own content, governed by the chat's rules, and this screen has no
 * business offering to sweep them. Their size is shown as context, not as a
 * target. See docs/attachment-lifecycle.md.
 */

interface ImageStoreStats {
  fileCount: number;
  totalBytes: number;
  oldestAt: string | null;
  maxAgeDays: number;
  maxTotalMb: number;
}

export function StorageSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  // COMPAT(attachmentStorage): added in v0.7.1, drop the gate when daemon floor >= v0.7.1.
  const isSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.attachmentStorage === true,
  );

  if (!isConnected) {
    return null;
  }

  return (
    <SettingsSection title={t("settings.host.storage.title")}>
      <View style={settingsStyles.card}>
        {isSupported ? <HostImageStoreRow serverId={serverId} /> : null}
      </View>
      {isSupported ? <RetentionCard serverId={serverId} /> : null}
    </SettingsSection>
  );
}

export function PreviewCacheSettingsSection() {
  return (
    <SettingsSection title="Storage & cache">
      <View style={settingsStyles.card}>
        <PreviewCacheRow withBorder={false} />
      </View>
    </SettingsSection>
  );
}

function HostImageStoreRow({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const [isClearing, setIsClearing] = useState(false);

  const statsQueryKey = ["attachmentImageStats", serverId];
  const stats = useFetchQuery<ImageStoreStats | null>({
    queryKey: statsQueryKey,
    enabled: client !== null,
    dataShape: "value",
    staleTimeMs: 10_000,
    queryFn: async () => {
      if (!client) {
        return null;
      }
      const payload = await client.getAttachmentImageStats();
      if (payload.error) {
        throw new Error(payload.error);
      }
      return payload;
    },
  });

  const handleClear = useCallback(async () => {
    if (!client) {
      return;
    }
    setIsClearing(true);
    try {
      // Dry run first: the confirm has to quote what will actually go, not what
      // the last refresh happened to see.
      const preview = await client.clearAttachmentImages({ dryRun: true });
      if (preview.error) {
        throw new Error(preview.error);
      }
      if (preview.matched === 0) {
        toast.show(t("settings.host.storage.nothingToClear"));
        return;
      }

      const confirmed = await confirmDialog({
        title: t("settings.host.storage.clearImagesTitle"),
        message: t("settings.host.storage.clearImagesMessage", {
          count: preview.matched,
          size: formatFileSize({ size: preview.freedBytes }),
        }),
        confirmLabel: t("settings.host.storage.clearConfirm"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }

      const result = await client.clearAttachmentImages({ dryRun: false });
      if (result.error) {
        throw new Error(result.error);
      }
      toast.show(
        t("settings.host.storage.clearedImages", {
          count: result.deleted,
          size: formatFileSize({ size: result.freedBytes }),
        }),
      );
      await queryClient.invalidateQueries({ queryKey: statsQueryKey });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIsClearing(false);
    }
    // statsQueryKey is derived from serverId; listing it would rebuild the
    // callback on every render for no behavioural gain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, queryClient, serverId, t, toast]);

  const onPressClear = useCallback(() => {
    void handleClear();
  }, [handleClear]);

  const data = stats.data ?? null;
  const isEmpty = data === null || data.fileCount === 0;

  return (
    <View style={settingsStyles.row} testID="storage-host-images-row">
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.host.storage.hostImages")}</Text>
        <Text style={settingsStyles.rowHint}>
          {isEmpty
            ? t("settings.host.storage.hostImagesEmpty")
            : t("settings.host.storage.hostImagesSummary", {
                size: formatFileSize({ size: data.totalBytes }),
                count: data.fileCount,
              })}
        </Text>
        <Text style={settingsStyles.rowHint}>{t("settings.host.storage.hostImagesHint")}</Text>
      </View>
      <Button
        variant="secondary"
        size="sm"
        disabled={isEmpty || isClearing}
        onPress={onPressClear}
        testID="storage-host-images-clear"
      >
        {t("settings.host.storage.clear")}
      </Button>
    </View>
  );
}

function PreviewCacheRow({ withBorder }: { withBorder: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [isClearing, setIsClearing] = useState(false);

  const usage = useFetchQuery<AttachmentStoreUsage>({
    queryKey: PREVIEW_USAGE_QUERY_KEY,
    dataShape: "value",
    staleTimeMs: 10_000,
    queryFn: readAttachmentStoreUsage,
  });

  const handleClear = useCallback(async () => {
    setIsClearing(true);
    try {
      // No confirm: every byte here is a copy of something the host still has,
      // so the worst case is one slower render.
      const result = await clearPreviewAttachments();
      toast.show(
        t("settings.host.storage.clearedPreviews", {
          count: result.deleted,
          size: formatFileSize({ size: result.freedBytes }),
        }),
      );
      await queryClient.invalidateQueries({ queryKey: PREVIEW_USAGE_QUERY_KEY });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIsClearing(false);
    }
  }, [queryClient, t, toast]);

  const onPressClear = useCallback(() => {
    void handleClear();
  }, [handleClear]);

  const data = usage.data ?? EMPTY_ATTACHMENT_STORE_USAGE;
  const isEmpty = data.previewCount === 0;

  return (
    <View
      style={withBorder ? ROW_WITH_BORDER : settingsStyles.row}
      testID="storage-preview-cache-row"
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.host.storage.previewCache")}</Text>
        <Text style={settingsStyles.rowHint}>
          {isEmpty
            ? t("settings.host.storage.previewCacheEmpty")
            : t("settings.host.storage.previewCacheSummary", {
                size: formatFileSize({ size: data.previewBytes }),
                count: data.previewCount,
              })}
        </Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.host.storage.previewCacheHint", {
            size: formatFileSize({ size: data.otherBytes }),
          })}
        </Text>
      </View>
      <Button
        variant="secondary"
        size="sm"
        disabled={isEmpty || isClearing}
        onPress={onPressClear}
        testID="storage-preview-cache-clear"
      >
        {t("settings.host.storage.clear")}
      </Button>
    </View>
  );
}

/**
 * The two numbers the daemon's background sweep runs on. Editable because a
 * constant only a developer can find is not a policy the user consented to -
 * and because the right answer differs wildly between a laptop and a workstation
 * that browser-verifies all day. Either at 0 turns that lever off.
 */
function RetentionCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { config, patchConfig } = useDaemonConfig(serverId);

  const patch = useCallback(
    (next: { attachmentImageMaxAgeDays?: number; attachmentImageMaxTotalMb?: number }) => {
      void patchConfig(next).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      });
    },
    [patchConfig, toast],
  );

  const setMaxAge = useCallback(
    (text: string) => {
      const parsed = parseRetentionNumber(text);
      if (parsed !== null) {
        patch({ attachmentImageMaxAgeDays: parsed });
      }
    },
    [patch],
  );
  const setMaxTotal = useCallback(
    (text: string) => {
      const parsed = parseRetentionNumber(text);
      if (parsed !== null) {
        patch({ attachmentImageMaxTotalMb: parsed });
      }
    },
    [patch],
  );

  return (
    <View style={RETENTION_CARD} testID="storage-retention-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.storage.maxAge")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.host.storage.maxAgeHint")}</Text>
        </View>
        <NumberStepperField
          size="sm"
          value={String(config?.attachmentImageMaxAgeDays ?? 30)}
          onChangeText={setMaxAge}
          min={0}
          max={3650}
          accessibilityLabel={t("settings.host.storage.maxAge")}
          testID="storage-retention-max-age"
        />
      </View>
      <View style={ROW_WITH_BORDER}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.storage.maxTotal")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.host.storage.maxTotalHint")}</Text>
        </View>
        <NumberStepperField
          size="sm"
          value={String(config?.attachmentImageMaxTotalMb ?? 512)}
          onChangeText={setMaxTotal}
          min={0}
          max={1_048_576}
          accessibilityLabel={t("settings.host.storage.maxTotal")}
          testID="storage-retention-max-total"
        />
      </View>
    </View>
  );
}

/**
 * The stepper reports raw text, including the empty string mid-edit. Only a
 * whole non-negative number is worth a config write; anything else means the
 * user is still typing, and persisting it would fight them.
 */
function parseRetentionNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

const PREVIEW_USAGE_QUERY_KEY = ["attachmentPreviewUsage"];

const styles = StyleSheet.create((theme) => ({
  retentionSpacing: {
    marginTop: theme.spacing[3],
  },
}));

const RETENTION_CARD = [settingsStyles.card, styles.retentionSpacing];
const ROW_WITH_BORDER = [settingsStyles.row, settingsStyles.rowBorder];
