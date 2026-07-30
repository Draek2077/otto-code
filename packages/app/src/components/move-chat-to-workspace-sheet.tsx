import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Check } from "@/components/icons/material-icons";
import type { MoveChatWorkspaceOption } from "@/workspace/move-chat-options";
import type { Theme } from "@/styles/theme";

const ThemedCheckIcon = withUnistyles(Check);
const selectedIconMapping = (theme: Theme) => ({ color: theme.colors.primary });

export interface MoveChatToWorkspaceSheetProps {
  visible: boolean;
  /** Chat title, shown so the user can confirm they picked the right tab. */
  chatLabel: string;
  options: MoveChatWorkspaceOption[];
  onClose: () => void;
  onMove: (workspaceId: string) => Promise<void>;
  testID?: string;
}

export function MoveChatToWorkspaceSheet({
  visible,
  chatLabel,
  options,
  onClose,
  onMove,
  testID = "move-chat-to-workspace",
}: MoveChatToWorkspaceSheetProps) {
  const { t } = useTranslation();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setSelectedWorkspaceId(null);
    setError(null);
    setIsPending(false);
  }, [visible]);

  const handleCancel = useCallback(() => {
    if (isPending) {
      return;
    }
    onClose();
  }, [isPending, onClose]);

  const handleMove = useCallback(async () => {
    if (isPending || !selectedWorkspaceId) {
      return;
    }
    try {
      setIsPending(true);
      setError(null);
      await onMove(selectedWorkspaceId);
      setIsPending(false);
      onClose();
    } catch (moveError) {
      // Keep the sheet open on failure: the daemon's reason is the only place the
      // user learns why, and closing would throw it away along with their pick.
      setIsPending(false);
      setError(
        moveError instanceof Error && moveError.message
          ? moveError.message
          : t("workspace.moveChat.errors.failed"),
      );
    }
  }, [isPending, onClose, onMove, selectedWorkspaceId, t]);

  const handleMoveVoid = useCallback(() => {
    void handleMove();
  }, [handleMove]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("workspace.moveChat.title"),
      subtitle: chatLabel,
    }),
    [chatLabel, t],
  );

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          variant="secondary"
          size="sm"
          style={styles.footerButton}
          onPress={handleCancel}
          disabled={isPending}
          testID={`${testID}-cancel`}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          size="sm"
          style={styles.footerButton}
          onPress={handleMoveVoid}
          disabled={isPending || !selectedWorkspaceId}
          testID={`${testID}-submit`}
        >
          {isPending ? t("workspace.moveChat.moving") : t("workspace.moveChat.move")}
        </Button>
      </View>
    ),
    [handleCancel, handleMoveVoid, isPending, selectedWorkspaceId, t, testID],
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={handleCancel}
      header={header}
      footer={footer}
      testID={testID}
    >
      <View style={styles.body}>
        {options.length === 0 ? (
          <Text style={styles.emptyText} testID={`${testID}-empty`}>
            {t("workspace.moveChat.empty")}
          </Text>
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {options.map((option) => (
              <WorkspaceOptionRow
                key={option.workspaceId}
                option={option}
                selected={option.workspaceId === selectedWorkspaceId}
                disabled={isPending}
                onSelect={setSelectedWorkspaceId}
                testID={`${testID}-option-${option.workspaceId}`}
              />
            ))}
          </ScrollView>
        )}
        {error ? (
          <Text style={styles.errorText} testID={`${testID}-error`}>
            {error}
          </Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

interface WorkspaceOptionRowProps {
  option: MoveChatWorkspaceOption;
  selected: boolean;
  disabled: boolean;
  onSelect: (workspaceId: string) => void;
  testID: string;
}

function WorkspaceOptionRow({
  option,
  selected,
  disabled,
  onSelect,
  testID,
}: WorkspaceOptionRowProps) {
  const handlePress = useCallback(() => {
    onSelect(option.workspaceId);
  }, [onSelect, option.workspaceId]);
  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      selected && styles.rowSelected,
      Boolean(hovered) && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [selected],
  );
  const accessibilityState = useMemo(() => ({ selected }), [selected]);

  return (
    <Pressable
      style={pressableStyle}
      onPress={handlePress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {option.label}
        </Text>
        {/* The project is always shown, not only when cross-project: two
            workspaces in different projects routinely share a name, and the
            project is the only thing that tells them apart. */}
        <Text style={styles.rowProject} numberOfLines={1}>
          {option.projectLabel}
        </Text>
      </View>
      {selected ? <ThemedCheckIcon size={16} uniProps={selectedIconMapping} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  list: {
    maxHeight: 320,
  },
  listContent: {
    gap: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  rowSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.surface2,
  },
  rowHovered: {
    borderColor: theme.colors.surface2,
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowText: {
    flex: 1,
    gap: theme.spacing[1],
  },
  rowLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowProject: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[3],
  },
  errorText: {
    color: theme.colors.palette.red[300],
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
