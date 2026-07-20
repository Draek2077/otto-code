import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Check } from "@/components/icons/material-icons";
import type { Theme } from "@/styles/theme";
import { useConfirmDialogStore } from "@/utils/confirm-dialog";

const checkColorMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
const ThemedCheck = withUnistyles(Check);

/**
 * Renders queued confirmation requests from {@link useConfirmDialogStore} as a
 * themed, cross-platform dialog. Mounted once, globally, so `confirmDialog`
 * (and `confirmDialogWithCheckbox`) work as imperative promises from anywhere.
 */
export function ConfirmDialogHost() {
  const { t } = useTranslation();
  const active = useConfirmDialogStore((state) => state.queue[0] ?? null);
  const resolveActive = useConfirmDialogStore((state) => state.resolveActive);
  const [checkboxChecked, setCheckboxChecked] = useState(false);

  // Reset the checkbox whenever a new request becomes active.
  const activeId = active?.id ?? null;
  useEffect(() => {
    setCheckboxChecked(false);
  }, [activeId]);

  const handleCancel = useCallback(() => {
    resolveActive({ confirmed: false, checkboxChecked });
  }, [resolveActive, checkboxChecked]);

  const handleConfirm = useCallback(() => {
    resolveActive({ confirmed: true, checkboxChecked });
  }, [resolveActive, checkboxChecked]);

  const toggleCheckbox = useCallback(() => setCheckboxChecked((prev) => !prev), []);

  const header = useMemo<SheetHeader>(() => ({ title: active?.title ?? "" }), [active?.title]);

  const checkboxStyle = useMemo(
    () => [styles.checkbox, checkboxChecked && styles.checkboxChecked],
    [checkboxChecked],
  );
  const checkboxAccessibilityState = useMemo(
    () => ({ checked: checkboxChecked }),
    [checkboxChecked],
  );

  // An alert has nothing to decline, so it shows a single acknowledge button —
  // the backdrop/escape close still resolves it (as declined, which no alert
  // caller reads).
  const isAlert = active?.kind === "alert";
  const isDestructive = active?.destructive ?? false;
  const confirmLabel =
    active?.confirmLabel ?? t(isAlert ? "common.actions.dismiss" : "common.actions.confirm");
  const cancelLabel = active?.cancelLabel ?? t("common.actions.cancel");

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        {isAlert ? null : (
          <Button
            variant="secondary"
            size="sm"
            style={styles.footerButton}
            onPress={handleCancel}
            testID="confirm-dialog-cancel"
          >
            {cancelLabel}
          </Button>
        )}
        <Button
          variant={isDestructive ? "destructive" : "default"}
          size="sm"
          style={styles.footerButton}
          onPress={handleConfirm}
          testID="confirm-dialog-confirm"
        >
          {confirmLabel}
        </Button>
      </View>
    ),
    [cancelLabel, confirmLabel, handleCancel, handleConfirm, isAlert, isDestructive],
  );

  if (!active) {
    return null;
  }

  return (
    <AdaptiveModalSheet
      visible
      onClose={handleCancel}
      header={header}
      footer={footer}
      testID="confirm-dialog"
    >
      <View style={styles.body}>
        <Text style={styles.message}>{active.message}</Text>
        {active.checkboxLabel ? (
          <Pressable
            style={styles.checkboxRow}
            onPress={toggleCheckbox}
            accessibilityRole="checkbox"
            accessibilityState={checkboxAccessibilityState}
            aria-checked={checkboxChecked}
            testID="confirm-dialog-checkbox"
          >
            <View style={checkboxStyle}>
              {checkboxChecked ? <ThemedCheck size={14} uniProps={checkColorMapping} /> : null}
            </View>
            <Text style={styles.checkboxLabel}>{active.checkboxLabel}</Text>
          </Pressable>
        ) : null}
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
  checkboxRow: {
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
  checkboxLabel: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
}));
