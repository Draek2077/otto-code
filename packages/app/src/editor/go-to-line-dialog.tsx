import { useCallback, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/styles/theme";

const ThemedLineInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

/** Positive integer or null; the editor core clamps to the document's range. */
export function parseGoToLineInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const line = Number.parseInt(trimmed, 10);
  return line >= 1 ? line : null;
}

export function GoToLineDialog({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (line: number) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const line = parseGoToLineInput(value);

  const handleClose = useCallback(() => {
    setValue("");
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(() => {
    const parsed = parseGoToLineInput(value);
    if (parsed === null) {
      return;
    }
    setValue("");
    onSubmit(parsed);
  }, [onSubmit, value]);

  const handleKeyPress = useCallback(
    (event: { nativeEvent: { key: string } }) => {
      if (event.nativeEvent.key === "Escape") {
        handleClose();
      }
    },
    [handleClose],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose} testID="goto-line-dialog-backdrop">
        <Pressable style={styles.panel} testID="goto-line-dialog-panel">
          <Text style={styles.title}>{t("editor.goToLine.title")}</Text>
          <ThemedLineInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder={t("editor.goToLine.placeholder")}
            inputMode="numeric"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            blurOnSubmit={false}
            onSubmitEditing={handleSubmit}
            onKeyPress={handleKeyPress}
            testID="goto-line-dialog-input"
          />
          <View style={styles.actions}>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleClose}
              testID="goto-line-dialog-cancel"
            >
              {t("editor.cancel")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onPress={handleSubmit}
              disabled={line === null}
              testID="goto-line-dialog-confirm"
            >
              {t("editor.goToLine.go")}
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
    maxWidth: 320,
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
  input: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
}));
