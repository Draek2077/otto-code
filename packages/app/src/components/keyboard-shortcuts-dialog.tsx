import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { getIsElectronRuntime } from "@/constants/layout";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Shortcut } from "@/components/ui/shortcut";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { getShortcutOs } from "@/utils/shortcut-platform";
import {
  buildKeyboardShortcutHelpSections,
  getBindingIdForAction,
} from "@/keyboard/keyboard-shortcuts";
import { chordStringToShortcutKeys } from "@/keyboard/shortcut-string";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";

const SNAP_POINTS: string[] = ["70%", "92%"];

export function KeyboardShortcutsDialog() {
  const { t } = useTranslation();
  const open = useKeyboardShortcutsStore((s) => s.shortcutsDialogOpen);
  const setOpen = useKeyboardShortcutsStore((s) => s.setShortcutsDialogOpen);

  const isMac = getShortcutOs() === "mac";
  const isDesktopApp = getIsElectronRuntime();
  const { overrides } = useKeyboardShortcutOverrides();

  const platform = useMemo(() => ({ isMac, isDesktop: isDesktopApp }), [isDesktopApp, isMac]);
  const sections = useMemo(() => buildKeyboardShortcutHelpSections(platform), [platform]);

  // The help table's `keys` are the defaults, so each row's chord is resolved
  // against the user's remaps here — otherwise the dialog advertises a binding
  // that no longer fires.
  const chordsByRowId = useMemo(() => {
    const resolved = new Map<string, ShortcutKey[][]>();
    for (const section of sections) {
      for (const row of section.rows) {
        const bindingId = getBindingIdForAction(row.id, platform);
        const override = bindingId ? overrides[bindingId] : undefined;
        resolved.set(row.id, override ? chordStringToShortcutKeys(override) : [row.keys]);
      }
    }
    return resolved;
  }, [sections, platform, overrides]);

  const handleClose = useCallback(() => setOpen(false), [setOpen]);
  const header = useMemo<SheetHeader>(() => ({ title: t("settings.shortcuts.dialogTitle") }), [t]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={open}
      onClose={handleClose}
      testID="keyboard-shortcuts-dialog"
      snapPoints={SNAP_POINTS}
    >
      <View testID="keyboard-shortcuts-dialog-content" style={styles.content}>
        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{t(section.titleKey)}</Text>
            <View style={styles.rows}>
              {section.rows.map((row) => (
                <View key={row.id} style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{t(row.labelKey)}</Text>
                    {row.note ? (
                      <Text style={styles.rowNote}>{row.noteKey ? t(row.noteKey) : row.note}</Text>
                    ) : null}
                  </View>
                  <Shortcut chord={chordsByRowId.get(row.id)} style={styles.rowShortcut} />
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    gap: theme.spacing[4],
  },
  section: {
    gap: theme.spacing[2],
  },
  sectionTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  rows: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.surface2,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  rowNote: {
    marginTop: 2,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  rowShortcut: {
    alignSelf: "flex-start",
  },
}));
