import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Check } from "@/components/icons/material-icons";
import type { Theme } from "@/styles/theme";

const ARCHIVE_CHAT_WARNING_STORAGE_KEY = "archive-chat-warning";

interface ArchiveChatWarningPrefState {
  // When true, the "Archiving a chat puts it in History" confirmation is
  // suppressed and closing an agent chat archives it without prompting.
  suppressed: boolean;
  setSuppressed: (suppressed: boolean) => void;
}

export const useArchiveChatWarningPrefStore = create<ArchiveChatWarningPrefState>()(
  persist(
    (set) => ({
      suppressed: false,
      setSuppressed: (suppressed) => set({ suppressed }),
    }),
    {
      name: ARCHIVE_CHAT_WARNING_STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ suppressed: state.suppressed }),
    },
  ),
);

type ConfirmResolver = (confirmed: boolean) => void;

interface ArchiveChatWarningRequestState {
  resolve: ConfirmResolver | null;
  open: (resolve: ConfirmResolver) => void;
  close: () => void;
}

const useArchiveChatWarningRequestStore = create<ArchiveChatWarningRequestState>((set) => ({
  resolve: null,
  open: (resolve) => set({ resolve }),
  close: () => set({ resolve: null }),
}));

/**
 * Confirms archiving an agent chat on close. Resolves `true` when the user
 * accepts (or has previously suppressed the warning) and `false` when they
 * cancel. Rendered by the globally-mounted {@link ArchiveChatWarningModal}.
 */
export function confirmArchiveChat(): Promise<boolean> {
  if (useArchiveChatWarningPrefStore.getState().suppressed) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    useArchiveChatWarningRequestStore.getState().open(resolve);
  });
}

const checkColorMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
const ThemedCheck = withUnistyles(Check);

export function ArchiveChatWarningModal() {
  const { t } = useTranslation();
  const resolve = useArchiveChatWarningRequestStore((state) => state.resolve);
  const close = useArchiveChatWarningRequestStore((state) => state.close);
  const setSuppressed = useArchiveChatWarningPrefStore((state) => state.setSuppressed);
  const [suppressChecked, setSuppressChecked] = useState(false);

  const visible = resolve !== null;

  const settle = useCallback(
    (confirmed: boolean) => {
      const pending = useArchiveChatWarningRequestStore.getState().resolve;
      close();
      setSuppressChecked(false);
      pending?.(confirmed);
    },
    [close],
  );

  const handleCancel = useCallback(() => settle(false), [settle]);

  const handleConfirm = useCallback(() => {
    if (suppressChecked) {
      setSuppressed(true);
    }
    settle(true);
  }, [suppressChecked, setSuppressed, settle]);

  const toggleSuppress = useCallback(() => setSuppressChecked((prev) => !prev), []);

  const header = useMemo<SheetHeader>(
    () => ({ title: t("workspace.tabs.confirmations.archiveHistoryTitle") }),
    [t],
  );

  const checkboxStyle = useMemo(
    () => [styles.checkbox, suppressChecked && styles.checkboxChecked],
    [suppressChecked],
  );
  const suppressAccessibilityState = useMemo(
    () => ({ checked: suppressChecked }),
    [suppressChecked],
  );

  if (!visible) {
    return null;
  }

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={handleCancel}
      header={header}
      testID="archive-chat-warning"
    >
      <View style={styles.body}>
        <Text style={styles.message}>
          {t("workspace.tabs.confirmations.archiveHistoryMessage")}
        </Text>
        <Pressable
          style={styles.suppressRow}
          onPress={toggleSuppress}
          accessibilityRole="checkbox"
          accessibilityState={suppressAccessibilityState}
          aria-checked={suppressChecked}
          testID="archive-chat-warning-suppress"
        >
          <View style={checkboxStyle}>
            {suppressChecked ? <ThemedCheck size={14} uniProps={checkColorMapping} /> : null}
          </View>
          <Text style={styles.suppressLabel}>
            {t("workspace.tabs.confirmations.archiveHistorySuppress")}
          </Text>
        </Pressable>
        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            style={styles.actionButton}
            onPress={handleCancel}
            testID="archive-chat-warning-cancel"
          >
            {t("workspace.tabs.confirmations.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            style={styles.actionButton}
            onPress={handleConfirm}
            testID="archive-chat-warning-confirm"
          >
            {t("workspace.tabs.confirmations.archive")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  message: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: Math.round(theme.fontSize.base * 1.4),
  },
  suppressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  suppressLabel: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
  },
}));
