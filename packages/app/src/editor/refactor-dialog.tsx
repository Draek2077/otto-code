import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import type { Theme } from "@/styles/theme";
import type { EditorSelection } from "./editor-contract";
import { isRefactorInstructionValid } from "./refactor-prompt";

const ThemedInstructionInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

export interface RefactorDialogScope {
  path: string;
  selection: EditorSelection;
}

export function RefactorDialog({
  scope,
  visible,
  onClose,
  onConfirm,
}: {
  scope: RefactorDialogScope | null;
  visible: boolean;
  onClose: () => void;
  onConfirm: (instruction: string) => void;
}) {
  const { t } = useTranslation();
  const [instruction, setInstruction] = useState("");

  const scopeLabel = useMemo(() => {
    if (!scope || scope.selection.isEmpty) {
      return t("refactor.scopeWholeFile");
    }
    const { lineStart, lineEnd } = scope.selection;
    return lineStart === lineEnd
      ? t("refactor.scopeLine", { line: lineStart })
      : t("refactor.scopeLines", { start: lineStart, end: lineEnd });
  }, [scope, t]);

  const handleConfirm = useCallback(() => {
    if (!isRefactorInstructionValid(instruction)) {
      return;
    }
    onConfirm(instruction);
    setInstruction("");
  }, [instruction, onConfirm]);

  const handleClose = useCallback(() => {
    setInstruction("");
    onClose();
  }, [onClose]);

  const preview = scope?.selection.text.trim() ? scope.selection.text : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose} testID="refactor-dialog-backdrop">
        <Pressable style={styles.panel} testID="refactor-dialog-panel">
          <Text style={styles.title}>{t("refactor.title")}</Text>
          {scope ? (
            <Text
              style={styles.scopeText}
              testID="refactor-dialog-scope"
              dataSet={CODE_SURFACE_DATASET}
            >
              {scope.path} · {scopeLabel}
            </Text>
          ) : null}
          {preview ? (
            <ScrollView style={styles.previewBox} testID="refactor-dialog-preview">
              <Text style={styles.previewText} dataSet={CODE_SURFACE_DATASET}>
                {preview}
              </Text>
            </ScrollView>
          ) : null}
          <ThemedInstructionInput
            style={styles.input}
            value={instruction}
            onChangeText={setInstruction}
            placeholder={t("refactor.instructionPlaceholder")}
            multiline
            autoFocus
            testID="refactor-dialog-input"
          />
          <Text style={styles.guardNote}>{t("refactor.guardNote")}</Text>
          <View style={styles.actions}>
            <Button variant="ghost" size="sm" onPress={handleClose} testID="refactor-dialog-cancel">
              {t("editor.cancel")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onPress={handleConfirm}
              disabled={!isRefactorInstructionValid(instruction)}
              testID="refactor-dialog-confirm"
            >
              {t("refactor.confirm")}
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
    maxWidth: 560,
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
  scopeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
  },
  previewBox: {
    maxHeight: 140,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[2],
  },
  previewText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.code,
    fontFamily: theme.fontFamily.mono,
  },
  input: {
    minHeight: 72,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlignVertical: "top",
  },
  guardNote: {
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
