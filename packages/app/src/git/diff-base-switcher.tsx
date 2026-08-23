import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "@/components/icons/material-icons";
import { GitMerge } from "@/components/icons/lucide";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { useFetchQuery } from "@/data/query";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { type Theme } from "@/styles/theme";
import { invalidateCheckoutGitQueriesForClient } from "@/git/query-keys";
import {
  useCheckoutDiffBaseAnyRepoFeature,
  useWorktreeDiffBaseFeature,
} from "@/git/use-worktree-diff-base-feature";
import type { CheckoutBaseSource } from "@otto-code/protocol/messages";

/** A branch the base can be pointed at, and which sides of it exist. */
interface BranchCandidate {
  name: string;
  hasLocal: boolean;
  hasRemote: boolean;
}

/**
 * Tooltip copy per base provenance.
 *
 * Saying *why* matters as much as saying what. A detected parent is a guess about a graph that does
 * not record the answer, and presenting it with the same authority as an explicit pick is how a
 * wrong guess reads as "the diff is broken" instead of "let me repoint this".
 */
const BASE_SOURCE_LABEL_KEYS: Record<CheckoutBaseSource, string> = {
  inferred: "workspace.git.diff.baseChipInferred",
  worktree: "workspace.git.diff.baseChipWorktree",
  user: "workspace.git.diff.baseChipPinned",
  default: "workspace.git.diff.baseChipReadOnly",
};

/** Sentinel option id for "reset to the repository default branch". */
const DEFAULT_BASE_OPTION_ID = "\0otto:default-base";
/**
 * Sentinel option id for "detect this branch's parent again".
 *
 * Parent detection is a heuristic over a commit graph that does not record the answer, and the
 * result is remembered so it cannot drift. That combination needs an explicit way to ask for a
 * fresh answer, or a wrong guess is permanent.
 */
const REDETECT_BASE_OPTION_ID = "\0otto:redetect-base";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedGitMerge = withUnistyles(GitMerge);
const ThemedChevronDown = withUnistyles(ChevronDown);

interface DiffBaseSwitcherProps {
  /**
   * The base only describes the committed-vs-base diff, so the chip owns its own
   * visibility rather than making the pane branch around it.
   */
  visible: boolean;
  serverId: string;
  /** Workspace record id - the RPC key. Absent for a workspace with no record yet. */
  workspaceId: string | null | undefined;
  /** Workspace directory - the cwd git operations run in. */
  cwd: string;
  /** Display form of the current base (already stripped of refs/ prefixes). */
  baseRefLabel: string;
  currentBranchName: string | null;
  /**
   * Older daemons stored the base only in per-worktree metadata, so a plain checkout had nowhere
   * to put it and got the label without the picker. Newer daemons store it per branch and accept
   * any checkout - see `isBaseEditable`.
   */
  isOttoOwnedWorktree: boolean;
  /** Where the current base came from, so the chip can label a detected parent as a guess. */
  baseSource: CheckoutBaseSource | null;
  /** Daemon's answer to "can this checkout be repointed?"; null on daemons that predate it. */
  isBaseEditable: boolean | null;
}

/**
 * The "vs <base>" chip in the Changes toolbar.
 *
 * Two jobs, and the read-only one matters on its own: it names what the diff is measured
 * against, which is otherwise invisible. Where the host supports it, tapping repoints a
 * worktree at a different base - on a stacked branch that means the parent branch, so the
 * parent's commits stop showing up as the child's work.
 */
export function DiffBaseSwitcher({
  visible,
  serverId,
  workspaceId,
  cwd,
  baseRefLabel,
  currentBranchName,
  isOttoOwnedWorktree,
  baseSource,
  isBaseEditable,
}: DiffBaseSwitcherProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isSupported = useWorktreeDiffBaseFeature(serverId);
  const supportsAnyRepo = useCheckoutDiffBaseAnyRepoFeature(serverId);
  const toast = useToast();
  const queryClient = useQueryClient();

  // Capability detection happens here and nowhere else: downstream code reads one boolean.
  // On a daemon that stores the base per branch any checkout qualifies, so worktree ownership
  // stops being the gate; older daemons keep the worktree-only rule.
  const checkoutQualifies = supportsAnyRepo ? isBaseEditable !== false : isOttoOwnedWorktree;
  const canEdit =
    isSupported && checkoutQualifies && Boolean(client) && Boolean(workspaceId) && isConnected;

  const branchQuery = useFetchQuery({
    queryKey: ["diffBaseBranches", serverId, cwd],
    dataShape: "list",
    queryFn: async (): Promise<BranchCandidate[]> => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const payload = await client.getBranchSuggestions({ cwd, limit: 200 });
      if (payload.error) {
        throw new Error(payload.error);
      }
      if (payload.branchDetails) {
        return payload.branchDetails.map((branch) => ({
          name: branch.name,
          hasLocal: branch.hasLocal !== false,
          hasRemote: branch.hasRemote === true,
        }));
      }
      return (payload.branches ?? []).map((name) => ({
        name,
        hasLocal: true,
        hasRemote: false,
      }));
    },
    enabled: isOpen && canEdit,
    retry: false,
    staleTimeMs: 15_000,
  });

  const options = useMemo(() => {
    const rows: ComboboxProps["options"] = [
      {
        id: DEFAULT_BASE_OPTION_ID,
        label: t("workspace.git.diff.basePickerDefault"),
        description: t("workspace.git.diff.basePickerDefaultDescription"),
      },
    ];
    if (supportsAnyRepo) {
      rows.push({
        id: REDETECT_BASE_OPTION_ID,
        label: t("workspace.git.diff.basePickerRedetect"),
        description: t("workspace.git.diff.basePickerRedetectDescription"),
      });
    }
    for (const branch of branchQuery.data ?? []) {
      // Diffing a branch against itself is empty by definition; the daemon rejects
      // it too, so keep it out of the list rather than surfacing the error after.
      if (branch.name === currentBranchName) continue;
      if (branch.hasLocal) {
        rows.push({ id: branch.name, label: branch.name });
      }
      // A separate row for the remote-tracking side, because it is a different comparison
      // whenever local and origin have drifted - behind, ahead, or outright diverged. Only
      // offered on daemons that keep the qualifier; older ones strip it and the two rows would
      // silently do the same thing.
      if (branch.hasRemote && supportsAnyRepo) {
        const remoteId = `origin/${branch.name}`;
        rows.push({
          id: remoteId,
          label: remoteId,
          description: t("workspace.git.diff.basePickerRemoteDescription"),
        });
      }
    }
    return rows;
  }, [branchQuery.data, currentBranchName, supportsAnyRepo, t]);

  const handleSelect = useCallback(
    (optionId: string) => {
      setIsOpen(false);
      if (!client || !workspaceId) return;
      const isRedetect = optionId === REDETECT_BASE_OPTION_ID;
      const isSentinel = isRedetect || optionId === DEFAULT_BASE_OPTION_ID;
      const nextBaseRef = isSentinel ? null : optionId;
      setIsSaving(true);
      void (async () => {
        try {
          const payload = await client.setWorktreeBaseRef(
            workspaceId,
            nextBaseRef,
            isRedetect ? { redetect: true } : undefined,
          );
          if (payload.error) {
            throw new Error(payload.error);
          }
          await invalidateCheckoutGitQueriesForClient(queryClient, { serverId, cwd });
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : t("workspace.git.diff.baseChangeFailed"),
          );
        } finally {
          setIsSaving(false);
        }
      })();
    },
    [client, cwd, queryClient, serverId, t, toast, workspaceId, setIsOpen],
  );

  const handleOpen = useCallback(() => setIsOpen(true), []);

  const triggerStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.trigger,
      canEdit && !isSaving && (Boolean(hovered) || pressed || isOpen) && styles.triggerHovered,
      isSaving && styles.triggerDisabled,
    ],
    [canEdit, isOpen, isSaving],
  );

  const renderBranchOption = useCallback<NonNullable<ComboboxProps["renderOption"]>>(
    ({ option, selected, active, onPress }) => (
      <ComboboxItem
        label={option.label}
        description={option.description}
        selected={selected}
        active={active}
        disabled={option.disabled}
        onPress={onPress}
      />
    ),
    [],
  );

  if (!visible) {
    return null;
  }

  const label = t("workspace.git.diff.baseChip", { baseRef: baseRefLabel });
  const provenanceLabel = t(BASE_SOURCE_LABEL_KEYS[baseSource ?? "default"], {
    baseRef: baseRefLabel,
  });
  const accessibilityLabel = canEdit
    ? `${provenanceLabel} ${t("workspace.git.diff.baseChipTapToChange")}`
    : provenanceLabel;

  const chip = (
    <Pressable
      testID="changes-diff-base"
      onPress={handleOpen}
      disabled={!canEdit || isSaving}
      style={triggerStyle}
      accessibilityRole={canEdit ? "button" : "text"}
      accessibilityLabel={accessibilityLabel}
    >
      <ThemedGitMerge size="xs" uniProps={mutedColorMapping} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <ThemedChevronDown size="xs" uniProps={mutedColorMapping} />
    </Pressable>
  );

  return (
    <View ref={anchorRef} collapsable={false} style={styles.anchor}>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent side="bottom">
          <Text style={styles.tooltipText}>{accessibilityLabel}</Text>
        </TooltipContent>
      </Tooltip>
      {canEdit ? (
        <Combobox
          options={options}
          value={baseRefLabel}
          onSelect={handleSelect}
          searchable
          placeholder={t("workspace.git.diff.basePickerPlaceholder")}
          searchPlaceholder={t("workspace.git.diff.basePickerSearchPlaceholder")}
          emptyText={t("workspace.git.diff.basePickerEmpty")}
          title={t("workspace.git.diff.basePickerTitle")}
          open={isOpen}
          onOpenChange={setIsOpen}
          anchorRef={anchorRef}
          desktopPlacement="bottom-start"
          desktopPreventInitialFlash
          desktopMinWidth={280}
          renderOption={renderBranchOption}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  anchor: {
    flexShrink: 1,
    minWidth: 0,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minWidth: 0,
    paddingHorizontal: theme.spacing[1],
    // Keep the base-branch picker aligned with the adjacent diff-mode dropdown.
    height: {
      xs: 28,
      sm: 28,
      md: 24,
    },
    borderRadius: theme.borderRadius.base,
    flexShrink: 1,
  },
  triggerHovered: {
    // Match the committed/uncommitted dropdown beside it.
    backgroundColor: theme.colors.surfaceHover,
  },
  triggerDisabled: {
    opacity: 0.6,
  },
  label: {
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
