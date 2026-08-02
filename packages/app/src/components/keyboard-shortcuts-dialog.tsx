import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Search } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import { isWeb } from "@/constants/platform";
import { formatShortcut } from "@/utils/format-shortcut";
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
import type { ShortcutKey, ShortcutOs } from "@/utils/format-shortcut";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";

const SNAP_POINTS: string[] = ["70%", "92%"];
const SEARCH_ICON_SIZE = 16;

const ThemedSearch = withUnistyles(Search);
const ThemedTextInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Spellings a person might type for a modifier that renders as a glyph.
 *
 * Without these, searching "cmd" finds nothing on a Mac because the row's key is
 * `mod` and the rendered chord is a symbol. Which aliases apply depends on the
 * platform: `mod` is Command on a Mac and Control everywhere else.
 */
function shortcutSearchAliases(keys: ShortcutKey[], isMac: boolean): string {
  return keys
    .flatMap((key) => {
      if (isMac) {
        if (key === "mod" || key === "meta") return ["cmd", "command"];
        if (key === "alt") return ["alt", "option"];
        return [key];
      }
      if (key === "mod" || key === "ctrl") return ["ctrl", "control"];
      if (key === "meta") return ["win", "windows"];
      return [key];
    })
    .join(" ");
}

/**
 * Everything a row can be found by, lowercased: its section, its label, its
 * note, and each resolved chord in three spellings (raw keys, the rendered
 * glyphs, and typeable modifier aliases).
 */
function buildShortcutSearchText(input: {
  text: (string | undefined)[];
  chords: ShortcutKey[][];
  shortcutOs: ShortcutOs;
  isMac: boolean;
}): string {
  const chordText = input.chords.flatMap((keys) => [
    keys.join(" "),
    formatShortcut(keys, input.shortcutOs),
    shortcutSearchAliases(keys, input.isMac),
  ]);
  return [...input.text, ...chordText].filter(Boolean).join(" ").toLocaleLowerCase();
}

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

  const [query, setQuery] = useState("");
  // A stale filter on reopen would look like a dialog that has lost most of its
  // shortcuts, so the query does not survive a close.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Matching runs against the RESOLVED chord rather than the row's default keys,
  // so a remapped shortcut is findable by what the user actually presses.
  const filteredSections = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return sections;
    const shortcutOs = isMac ? "mac" : "non-mac";
    return sections.flatMap((section) => {
      const rows = section.rows.filter((row) =>
        buildShortcutSearchText({
          text: [t(section.titleKey), t(row.labelKey), row.noteKey ? t(row.noteKey) : row.note],
          chords: chordsByRowId.get(row.id) ?? [row.keys],
          shortcutOs,
          isMac,
        }).includes(normalized),
      );
      return rows.length > 0 ? [{ ...section, rows }] : [];
    });
  }, [query, sections, chordsByRowId, isMac, t]);

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
        <View style={styles.searchField}>
          <View style={styles.searchIcon}>
            <ThemedSearch size={SEARCH_ICON_SIZE} uniProps={foregroundMutedColorMapping} />
          </View>
          <ThemedTextInput
            testID="keyboard-shortcuts-search"
            value={query}
            onChangeText={setQuery}
            accessibilityLabel={t("settings.shortcuts.searchPlaceholder")}
            placeholder={t("settings.shortcuts.searchPlaceholder")}
            // @ts-expect-error - outlineStyle is web-only
            style={[styles.searchInput, isWeb && { outlineStyle: "none" }]}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        {filteredSections.length === 0 ? (
          <Text testID="keyboard-shortcuts-empty" style={styles.emptyText}>
            {t("settings.shortcuts.searchEmpty")}
          </Text>
        ) : null}
        {filteredSections.map((section) => (
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
  searchField: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
  },
  searchIcon: {
    width: 18,
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
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
