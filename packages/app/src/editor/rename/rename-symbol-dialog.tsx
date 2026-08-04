import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/styles/theme";

const ThemedNameInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

/**
 * The new name for a rename job.
 *
 * A dialog for the NAME only - the audit happens in the job tab this opens, not here. That
 * split is the whole point: a dialog is the right shape for "what should it be called" (one
 * field, one answer) and the wrong shape for "here is everything this will change", which is
 * a surface you read, scroll, and click into.
 *
 * Deliberately no validation beyond non-empty and unchanged. What makes a legal identifier
 * is the language's business, and the language server is about to answer that authoritatively
 * by refusing to produce a plan. Guessing the rules here would mean rejecting names that are
 * fine in languages we did not think about.
 *
 * Strings are literal English pending the pre-release i18n sweep.
 */
export function RenameSymbolDialog({
  visible,
  symbol,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  /** The identifier being renamed; seeds the field so a small edit is a small edit. */
  symbol: string;
  onClose: () => void;
  onSubmit: (newName: string) => void;
}) {
  const [value, setValue] = useState(symbol);

  // Reseed each time it opens, and on a different symbol: a stale name from the last rename
  // sitting in the box is how you rename the wrong thing to the wrong thing.
  useEffect(() => {
    if (visible) {
      setValue(symbol);
    }
  }, [symbol, visible]);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== symbol;

  const handleSubmit = useCallback(() => {
    const next = value.trim();
    if (next.length === 0 || next === symbol) {
      return;
    }
    onSubmit(next);
  }, [onSubmit, symbol, value]);

  const handleKeyPress = useCallback(
    (event: { nativeEvent: { key: string } }) => {
      if (event.nativeEvent.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="rename-symbol-dialog-backdrop">
        <Pressable style={styles.panel} testID="rename-symbol-dialog-panel">
          <Text style={styles.title}>Rename symbol</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {symbol}
          </Text>
          <ThemedNameInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder="New name"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            blurOnSubmit={false}
            onSubmitEditing={handleSubmit}
            onKeyPress={handleKeyPress}
            testID="rename-symbol-dialog-input"
          />
          <Text style={styles.hint}>
            This opens a job tab showing every change it would make. Nothing is written until you
            apply it there.
          </Text>
          <View style={styles.actions}>
            <Button
              variant="ghost"
              size="sm"
              onPress={onClose}
              testID="rename-symbol-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onPress={handleSubmit}
              disabled={!canSubmit}
              testID="rename-symbol-dialog-confirm"
            >
              Preview rename
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  panel: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[4],
    gap: theme.spacing[2],
    ...theme.shadow.lg,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
  },
  input: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
}));
