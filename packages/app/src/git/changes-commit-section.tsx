import { useState, useCallback, useMemo, useRef, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, Pressable, type PressableStateCallbackType } from "react-native";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check, ChevronDown, SquareTerminal } from "@/components/icons/material-icons";
import {
  Combobox,
  ComboboxItem,
  type ComboboxOption,
  type ComboboxProps,
} from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useIconSize } from "@/styles/theme";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { useSessionStore } from "@/stores/session-store";
import { CheckoutGitCommitFailedError, useCheckoutGitActionsStore } from "@/git/actions-store";
import type { CheckoutGitCommitError } from "@otto-code/protocol/messages";
import { openGitLogTab } from "@/git/open-git-log-tab";
import { resolveRunningAgentLabels } from "@/git/running-agent-labels";
import {
  CONVENTIONAL_COMMIT_TYPES,
  NO_COMMIT_TYPE,
  formatConventionalCommitMessage,
  type CommitTypeChoice,
  type ConventionalCommitType,
} from "@/git/conventional-commit";
import { confirmDialog } from "@/utils/confirm-dialog";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

const ThemedCheck = withUnistyles(Check);
const ThemedChevronDown = withUnistyles(ChevronDown);
const foregroundMutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentForegroundIconColorMapping = (theme: Theme) => ({
  color: theme.colors.accentForeground,
});

const COMMIT_TYPE_DESCRIPTION_KEYS: Record<ConventionalCommitType, string> = {
  feat: "workspace.git.commit.type.featDescription",
  fix: "workspace.git.commit.type.fixDescription",
  docs: "workspace.git.commit.type.docsDescription",
  style: "workspace.git.commit.type.styleDescription",
  refactor: "workspace.git.commit.type.refactorDescription",
  perf: "workspace.git.commit.type.perfDescription",
  test: "workspace.git.commit.type.testDescription",
  build: "workspace.git.commit.type.buildDescription",
  ci: "workspace.git.commit.type.ciDescription",
  chore: "workspace.git.commit.type.choreDescription",
  revert: "workspace.git.commit.type.revertDescription",
};

function renderCommitTypeOption({
  option,
  selected,
  active,
  onPress,
}: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <ComboboxItem
      label={option.label}
      description={option.description}
      selected={selected}
      active={active}
      onPress={onPress}
      testID={`changes-commit-type-option-${option.id}`}
    />
  );
}

/**
 * The git-cz style type chip + Combobox above the commit message input.
 *
 * Owns its picker state (open/close, anchor) so the surrounding section stays
 * simple. The selected type itself lives in the changes-preferences store and
 * is read back by the section, which is what builds the `type: subject`
 * message at commit time - this component just chooses it.
 */
function CommitTypeSelector({
  value,
  onCommitTypeChange,
}: {
  value: CommitTypeChoice;
  onCommitTypeChange: (next: CommitTypeChoice) => void;
}) {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);

  const options = useMemo<ComboboxProps["options"]>(
    () => [
      {
        id: NO_COMMIT_TYPE,
        label: t("workspace.git.commit.type.none"),
        description: t("workspace.git.commit.type.noneDescription"),
      },
      ...CONVENTIONAL_COMMIT_TYPES.map<ComboboxProps["options"][number]>((type) => ({
        id: type,
        label: type,
        description: t(COMMIT_TYPE_DESCRIPTION_KEYS[type]),
      })),
    ],
    [t],
  );

  const handleSelect = useCallback(
    (id: string) => {
      setOpen(false);
      const next: CommitTypeChoice = (CONVENTIONAL_COMMIT_TYPES as readonly string[]).includes(id)
        ? (id as ConventionalCommitType)
        : NO_COMMIT_TYPE;
      if (next !== value) {
        onCommitTypeChange(next);
      }
    },
    [onCommitTypeChange, value],
  );
  const handleOpen = useCallback(() => setOpen(true), []);

  const triggerStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.commitTypeTrigger,
      (hovered || pressed || open) && styles.commitTypeTriggerHovered,
    ],
    [open],
  );

  return (
    <View ref={anchorRef} collapsable={false} style={styles.commitTypeAnchor}>
      <Pressable
        testID="changes-commit-type-selector"
        onPress={handleOpen}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.git.commit.type.selectorLabel")}
      >
        <Text style={styles.commitTypeLabel} numberOfLines={1}>
          {t("workspace.git.commit.type.selectorLabel")}
        </Text>
        <Text style={styles.commitTypeValue} numberOfLines={1}>
          {value === NO_COMMIT_TYPE ? t("workspace.git.commit.type.none") : value}
        </Text>
        <ThemedChevronDown size="xs" uniProps={foregroundMutedIconColorMapping} />
      </Pressable>
      <Combobox
        options={options}
        value={value}
        onSelect={handleSelect}
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
        desktopMinWidth={240}
        title={t("workspace.git.commit.type.selectorLabel")}
        renderOption={renderCommitTypeOption}
      />
    </View>
  );
}

/**
 * The select-all / commit button row and the inline error beneath it, pulled
 * out of the section so the commit logic and the selection-state branching
 * don't pile into one oversized render function.
 */
function CommitActionRow({
  serverId,
  workspaceId,
  logSupported,
  selectedPathsCount,
  totalFiles,
  allSelected,
  partiallySelected,
  onToggleSelectAll,
  isCommitting,
  commitDisabled,
  onCommit,
  commitError,
}: {
  serverId: string;
  workspaceId: string | null | undefined;
  logSupported: boolean;
  selectedPathsCount: number;
  totalFiles: number;
  allSelected: boolean;
  partiallySelected: boolean;
  onToggleSelectAll: () => void;
  isCommitting: boolean;
  commitDisabled: boolean;
  onCommit: () => void;
  commitError: CheckoutGitCommitError | null;
}) {
  const { t } = useTranslation();
  const errorDescription = commitError ? describeCommitError(commitError, t) : null;
  const selectAllAccessibilityState = useMemo(
    () => ({ checked: partiallySelected ? ("mixed" as const) : allSelected }),
    [allSelected, partiallySelected],
  );

  let selectAllMark: ReactElement | null = null;
  if (partiallySelected) {
    selectAllMark = <View style={styles.fileCheckboxIndeterminateMark} />;
  } else if (allSelected) {
    selectAllMark = <ThemedCheck size="xs" uniProps={accentForegroundIconColorMapping} />;
  }

  return (
    <>
      <View style={styles.commitActions}>
        <View style={styles.commitSelectionGroup}>
          <Pressable
            style={
              allSelected || partiallySelected
                ? [styles.fileCheckbox, styles.fileCheckboxChecked]
                : styles.fileCheckbox
            }
            onPress={onToggleSelectAll}
            accessibilityRole="checkbox"
            accessibilityState={selectAllAccessibilityState}
            aria-checked={partiallySelected ? "mixed" : allSelected}
            accessibilityLabel={
              allSelected
                ? t("workspace.git.commit.deselectAllFiles")
                : t("workspace.git.commit.selectAllFiles")
            }
            hitSlop={6}
            testID="changes-commit-select-all"
          >
            {selectAllMark}
          </Pressable>
          <Text style={styles.commitSelectionCount} numberOfLines={1}>
            {t("workspace.git.commit.filesSelected", {
              selected: selectedPathsCount,
              total: totalFiles,
            })}
          </Text>
        </View>
        <View style={styles.commitButtonGroup}>
          <CommitLogButton serverId={serverId} workspaceId={workspaceId} enabled={logSupported} />
          <Button
            size="sm"
            variant="default"
            disabled={commitDisabled}
            onPress={onCommit}
            testID="changes-commit-button"
          >
            {isCommitting ? t("workspace.git.commit.committing") : t("workspace.git.commit.button")}
          </Button>
        </View>
      </View>
      {errorDescription ? (
        <Text style={styles.commitErrorText} testID="changes-commit-error">
          {errorDescription.title}
        </Text>
      ) : null}
      {errorDescription?.detail ? (
        <Text style={styles.commitErrorDetail} testID="changes-commit-error-detail">
          {errorDescription.detail}
        </Text>
      ) : null}
    </>
  );
}

interface ChangesCommitSectionProps {
  serverId: string;
  cwd: string;
  workspaceId: string | null | undefined;
  selectedPaths: string[];
  totalFiles: number;
  commitSupported: boolean;
  logSupported: boolean;
  // Visibility inputs the section resolves itself (keeps the parent's render
  // flat): the form only exists for a git checkout showing uncommitted changes.
  isGit: boolean;
  diffMode: "uncommitted" | "base";
  hasChanges: boolean;
  onToggleSelectAll: () => void;
  onCommitted: () => void;
}

interface CommitErrorDescription {
  title: string;
  detail: string | null;
}

function describeCommitError(
  error: CheckoutGitCommitError,
  t: ReturnType<typeof useTranslation>["t"],
): CommitErrorDescription {
  switch (error.kind) {
    case "identity_missing":
      return { title: t("workspace.git.commit.errorIdentity"), detail: null };
    case "hook_failed":
      // The raw hook output is not actionable here, so only the error
      // sentence is shown; the full log stays available via the log tab.
      return { title: t("workspace.git.commit.errorHook"), detail: null };
    case "signing_failed":
      return { title: t("workspace.git.commit.errorSigning"), detail: error.detail.trim() || null };
    case "nothing_to_commit":
      return { title: t("workspace.git.commit.errorNothingToCommit"), detail: null };
    case "git_failed":
      return {
        title: t("workspace.git.commit.errorGitFailed"),
        detail: error.detail.trim() || null,
      };
    case "agents_running":
      // Surfaces as a confirm dialog before retry, never as an inline error.
      return { title: t("workspace.git.commit.errorGitFailed"), detail: null };
  }
}

function CommitLogButton({
  serverId,
  workspaceId,
  enabled,
}: {
  serverId: string;
  workspaceId: string | null | undefined;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  // Doubled on mobile (14 -> 28); unchanged (14) on desktop.
  const logIconSize = useIconSize().sm;
  const handleOpenLog = useCallback(() => {
    if (workspaceId) {
      openGitLogTab({ serverId, workspaceId, operation: "commit" });
    }
  }, [serverId, workspaceId]);

  if (!enabled || !workspaceId) {
    return null;
  }

  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={SquareTerminal}
          iconSize={logIconSize}
          onPress={handleOpenLog}
          accessibilityLabel={t("workspace.git.commit.viewLog")}
          testID="changes-commit-log-button"
        />
      </TooltipTrigger>
      <TooltipContent side="top" align="end" offset={6}>
        <Text style={styles.tooltipText}>{t("workspace.git.commit.viewLog")}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

export function ChangesCommitSection({
  serverId,
  cwd,
  workspaceId,
  selectedPaths,
  totalFiles,
  commitSupported,
  logSupported,
  isGit,
  diffMode,
  hasChanges,
  onToggleSelectAll,
  onCommitted,
}: ChangesCommitSectionProps) {
  const { t } = useTranslation();
  const agentsById = useSessionStore((state) => state.sessions[serverId]?.agents);
  const [message, setMessage] = useState("");
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [commitError, setCommitError] = useState<CheckoutGitCommitError | null>(null);
  const commitPaths = useCheckoutGitActionsStore((s) => s.commitPaths);
  const isCommitting =
    useCheckoutGitActionsStore((s) => s.getStatus({ serverId, cwd, actionId: "commit" })) ===
    "pending";
  const { preferences, updatePreferences } = useChangesPreferences();
  const commitType = preferences.commitType;
  const handleCommitTypeChange = useCallback(
    (next: CommitTypeChoice) => void updatePreferences({ commitType: next }),
    [updatePreferences],
  );

  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);
  const inputStyle = useMemo(
    () => [styles.commitInput, isFocused && styles.commitInputFocused],
    [isFocused],
  );

  const handleCommit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || selectedPaths.length === 0 || isCommitting) {
      return;
    }
    setCommitError(null);
    // Prefixing happens here, client-side: the daemon runs `git commit -m`
    // with this string verbatim, so `fix: handle null cursor` is what lands.
    const finalMessage = formatConventionalCommitMessage(commitType, trimmed);
    const attempt = async (allowWithRunningAgents: boolean): Promise<void> => {
      try {
        await commitPaths({
          serverId,
          cwd,
          message: finalMessage,
          paths: selectedPaths,
          ...(allowWithRunningAgents ? { allowWithRunningAgents: true } : {}),
        });
        setMessage("");
        inputRef.current?.replaceText("");
        onCommitted();
      } catch (error) {
        if (error instanceof CheckoutGitCommitFailedError) {
          if (error.commitError.kind === "agents_running") {
            const agents = resolveRunningAgentLabels(
              error.commitError.agents,
              agentsById,
              t("workspace.git.commit.unnamedAgent"),
            );
            const confirmed = await confirmDialog({
              title: t("workspace.git.commit.agentsRunningTitle"),
              message: t("workspace.git.commit.agentsRunningMessage", { agents }),
              confirmLabel: t("workspace.git.commit.agentsRunningConfirm"),
            });
            if (confirmed) {
              await attempt(true);
            }
            return;
          }
          setCommitError(error.commitError);
          return;
        }
        setCommitError({
          kind: "git_failed",
          detail: error instanceof Error ? error.message : t("workspace.git.commit.errorGitFailed"),
        });
      }
    };
    await attempt(false);
  }, [
    commitPaths,
    commitType,
    cwd,
    isCommitting,
    message,
    onCommitted,
    selectedPaths,
    serverId,
    t,
    agentsById,
  ]);

  const allSelected = totalFiles > 0 && selectedPaths.length === totalFiles;
  const partiallySelected = selectedPaths.length > 0 && !allSelected;

  if (!isGit || diffMode !== "uncommitted" || !hasChanges) {
    return null;
  }

  if (!commitSupported) {
    return (
      <View style={styles.commitSection} testID="changes-commit-section">
        <Text style={styles.commitUnsupportedText}>{t("workspace.git.commit.updateHost")}</Text>
      </View>
    );
  }

  const commitDisabled = message.trim().length === 0 || selectedPaths.length === 0 || isCommitting;

  return (
    <View style={styles.commitSection} testID="changes-commit-section">
      <CommitTypeSelector value={commitType} onCommitTypeChange={handleCommitTypeChange} />
      <EditingTextInput
        ref={inputRef}
        multiline
        initialValue={message}
        onChangeText={setMessage}
        onFocus={handleFocus}
        onBlur={handleBlur}
        editable={!isCommitting}
        placeholder={t("workspace.git.commit.messagePlaceholder")}
        placeholderTextColor={styles.commitPlaceholderColor.color}
        accessibilityLabel={t("workspace.git.commit.messagePlaceholder")}
        style={inputStyle}
        testID="changes-commit-message"
      />
      <CommitActionRow
        serverId={serverId}
        workspaceId={workspaceId}
        logSupported={logSupported}
        selectedPathsCount={selectedPaths.length}
        totalFiles={totalFiles}
        allSelected={allSelected}
        partiallySelected={partiallySelected}
        onToggleSelectAll={onToggleSelectAll}
        isCommitting={isCommitting}
        commitDisabled={commitDisabled}
        onCommit={handleCommit}
        commitError={commitError}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  fileCheckbox: {
    width: 16,
    height: 16,
    flexShrink: 0,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted,
    alignItems: "center",
    justifyContent: "center",
    marginRight: theme.spacing[1],
  },
  fileCheckboxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  fileCheckboxIndeterminateMark: {
    width: 8,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.accentForeground,
  },
  commitSection: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[2],
  },
  commitTypeAnchor: {
    // The chip is its own width; the row stays left-aligned.
    alignSelf: "flex-start",
  },
  commitTypeTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    height: 28,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
  },
  commitTypeTriggerHovered: {
    backgroundColor: theme.colors.surfaceInteractiveHover,
  },
  commitTypeLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    flexShrink: 1,
  },
  commitTypeValue: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    // Compact bump: +2px on mobile, matching the message input font.
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    flexShrink: 1,
  },
  commitInput: {
    minHeight: 56,
    maxHeight: 120,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    // Compact bump: +2px on mobile, matching the file list and count text.
    fontSize: {
      xs: theme.fontSize.sm + 2,
      md: theme.fontSize.sm,
    },
    lineHeight: {
      xs: (theme.fontSize.sm + 2) * 1.4,
      md: theme.fontSize.sm * 1.4,
    },
    textAlignVertical: "top",
    ...(isWeb
      ? {
          outlineWidth: 0,
          outlineColor: "transparent",
        }
      : {}),
  },
  commitInputFocused: {
    borderColor: theme.colors.accent,
  },
  commitPlaceholderColor: {
    color: theme.colors.foregroundMuted,
  },
  commitActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  commitSelectionGroup: {
    flexDirection: "row",
    alignItems: "center",
    // The checkbox's built-in marginRight (4px) plus this gap matches the 8px
    // the file rows get from marginRight + fileHeaderLeft's gap, so the count
    // text lines up with the filenames below.
    gap: theme.spacing[1],
    flexShrink: 1,
    minWidth: 0,
  },
  commitSelectionCount: {
    color: theme.colors.foregroundMuted,
    // Compact bump: +2px on mobile, matching the file list and commit box.
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    flexShrink: 1,
  },
  commitButtonGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  commitUnsupportedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  commitErrorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.4,
  },
  commitErrorDetail: {
    color: theme.colors.foregroundMuted,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.5,
    fontFamily: theme.fontFamily.mono,
  },
  tooltipText: { fontSize: theme.fontSize.xs, color: theme.colors.foreground },
}));
