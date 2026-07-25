import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";

export type FileNameSheetMode = "create-file" | "create-folder" | "rename";

export interface FileNameSheetProps {
  visible: boolean;
  onClose: () => void;
  mode: FileNameSheetMode;
  /** Prefilled for rename (the entry's current leaf name); empty when creating. */
  initialValue?: string;
  /** Workspace-relative directory the name lands in, shown as a hint. */
  parentLabel: string;
  /**
   * Resolves with an error message to show inline, or null when the mutation
   * succeeded and the sheet should close. The sheet does not decide what a
   * conflict means — the daemon's typed result does, and the caller translates
   * it — but it does stay open so the user can pick another name.
   */
  onSubmit: (name: string) => Promise<string | null>;
}

function openKey(props: FileNameSheetProps): string {
  return `${props.mode}:${props.parentLabel}:${props.initialValue ?? ""}`;
}

/**
 * Mount gate, same shape as ArtifactCreateSheet: the sheet unmounts on dismiss
 * so reopening starts from a clean field rather than from whatever the last
 * cancelled attempt left behind.
 */
export function FileNameSheet(props: FileNameSheetProps): ReactElement | null {
  const [renderedProps, setRenderedProps] = useState<FileNameSheetProps | null>(() =>
    props.visible ? props : null,
  );
  const [sheetVisible, setSheetVisible] = useState(props.visible);
  const livePropsRef = useRef(props);
  const closeRequestedRef = useRef(false);
  livePropsRef.current = props;

  useEffect(() => {
    if (props.visible) {
      if (closeRequestedRef.current) {
        return;
      }
      setRenderedProps(props);
      setSheetVisible(true);
      return;
    }
    if (renderedProps) {
      setSheetVisible(false);
    }
  }, [props, renderedProps]);

  const requestClose = useCallback(() => {
    closeRequestedRef.current = true;
    setSheetVisible(false);
  }, []);

  const handleDismiss = useCallback(() => {
    const dismissedProps = livePropsRef.current;
    closeRequestedRef.current = false;
    setRenderedProps(null);
    setSheetVisible(false);
    if (dismissedProps.visible) {
      dismissedProps.onClose();
    }
  }, []);

  if (!renderedProps) {
    return null;
  }

  return (
    <OpenFileNameSheet
      key={openKey(renderedProps)}
      {...renderedProps}
      visible={sheetVisible}
      onClose={requestClose}
      onDismiss={handleDismiss}
    />
  );
}

function OpenFileNameSheet({
  visible,
  onClose,
  onDismiss,
  mode,
  initialValue,
  parentLabel,
  onSubmit,
}: FileNameSheetProps & { onDismiss: () => void }): ReactElement {
  const { t } = useTranslation();
  const [name, setName] = useState(initialValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  // Renaming to the same name is a no-op, not a mutation worth sending.
  const canSubmit = trimmed.length > 0 && trimmed !== (initialValue ?? "") && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const failure = await onSubmit(trimmed);
      if (failure) {
        setError(failure);
        return;
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, onClose, onSubmit, trimmed]);

  const handleSubmitPress = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const title = useMemo(() => {
    switch (mode) {
      case "create-file":
        return t("workspace.fileExplorer.dialogs.newFile.title");
      case "create-folder":
        return t("workspace.fileExplorer.dialogs.newFolder.title");
      case "rename":
        return t("workspace.fileExplorer.dialogs.rename.title");
    }
  }, [mode, t]);

  const placeholder =
    mode === "create-folder"
      ? t("workspace.fileExplorer.dialogs.newFolder.placeholder")
      : t("workspace.fileExplorer.dialogs.newFile.placeholder");

  const header = useMemo<SheetHeader>(() => ({ title }), [title]);

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          style={styles.footerButton}
          variant="secondary"
          onPress={onClose}
          disabled={submitting}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={handleSubmitPress}
          disabled={!canSubmit}
          loading={submitting}
          testID="file-name-sheet-submit"
        >
          {mode === "rename"
            ? t("workspace.fileExplorer.dialogs.rename.confirm")
            : t("common.actions.create")}
        </Button>
      </View>
    ),
    [canSubmit, handleSubmitPress, mode, onClose, submitting, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      footer={footer}
      testID="file-name-sheet"
    >
      <View style={styles.field}>
        <Text style={styles.label}>{t("workspace.fileExplorer.dialogs.nameLabel")}</Text>
        <AdaptiveTextInput
          testID="file-name-input"
          accessibilityLabel={title}
          initialValue={initialValue ?? ""}
          value={name}
          onChangeText={setName}
          onSubmitEditing={handleSubmitPress}
          placeholder={placeholder}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="done"
        />
        {/* The destination is stated rather than assumed: "New file" from a row
            deep in the tree lands next to that row, not at the workspace root. */}
        <Text style={styles.hint}>
          {t("workspace.fileExplorer.dialogs.inFolder", { folder: parentLabel })}
        </Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing[3],
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
}));
