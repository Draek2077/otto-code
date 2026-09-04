import React, { Fragment, useCallback, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ToolbarIconButton,
  type ToolbarIconButtonTone,
  type ToolbarIconComponent,
} from "@/components/ui/toolbar-icon-button";
import { MoreHorizontal } from "@/components/icons/material-icons";
import { FileViewModeBar, type FileViewModeBarProps } from "@/components/file-view-mode-bar";
import type { Theme } from "@/styles/theme";

const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);

const mutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * A command which is one tap away in the compact File Editor's actions sheet.
 *
 * Phone editing is an explicit two-tier interaction model: save, revert, and
 * find stay on the surface while infrequent file, Git, AI, export, and view
 * actions stay reachable through a labelled bottom sheet. This is deliberately
 * separate from the desktop toolbar's width-based collapse behaviour.
 */
export interface CompactFileToolbarAction {
  id: string;
  label: string;
  Icon: ToolbarIconComponent;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  selected?: boolean;
  tone?: ToolbarIconButtonTone;
  /** Starts a new visual group in the actions sheet. */
  separatorBefore?: boolean;
}

interface CompactFileToolbarProps {
  /** Commands retained on the editing surface. Keep this list short. */
  primaryActions: readonly CompactFileToolbarAction[];
  /** Every contextual command that does not earn permanent toolbar space. */
  moreActions: readonly CompactFileToolbarAction[];
  moreActionsLabel: string;
  modeBar: FileViewModeBarProps | null;
  /** Host-owned compact control, retained when a caller has one. */
  accessory?: ReactNode;
}

function CompactMoreActionsTrigger({ label }: { label: string }) {
  const triggerStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      styles.moreTrigger,
      (hovered || pressed || open) && styles.moreTriggerActive,
    ],
    [],
  );
  return (
    <DropdownMenuTrigger
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="compact-file-toolbar-more"
      style={triggerStyle}
    >
      <ThemedMoreHorizontal size="md" uniProps={mutedIconColorMapping} />
    </DropdownMenuTrigger>
  );
}

function CompactMoreAction({ action }: { action: CompactFileToolbarAction }) {
  const leading = React.createElement(action.Icon, { size: 16, uniProps: mutedIconColorMapping });
  return (
    <DropdownMenuItem
      disabled={action.disabled || action.loading}
      selected={action.selected}
      status={action.loading ? "pending" : undefined}
      leading={leading}
      onSelect={action.onPress}
      testID={`compact-file-toolbar-${action.id}`}
    >
      {action.label}
    </DropdownMenuItem>
  );
}

export function CompactFileToolbar({
  primaryActions,
  moreActions,
  moreActionsLabel,
  modeBar,
  accessory,
}: CompactFileToolbarProps) {
  return (
    <View style={styles.container} testID="compact-file-toolbar">
      <View style={styles.commandRow}>
        <View style={styles.primaryActions}>
          {primaryActions.map((action) => (
            <ToolbarIconButton
              key={action.id}
              label={action.label}
              testID={`compact-file-toolbar-${action.id}`}
              Icon={action.Icon}
              onPress={action.onPress}
              disabled={action.disabled}
              loading={action.loading}
              selected={action.selected}
              tone={action.tone}
            />
          ))}
          {accessory}
        </View>
        {moreActions.length > 0 ? (
          <DropdownMenu compactMode="sheet">
            <CompactMoreActionsTrigger label={moreActionsLabel} />
            <DropdownMenuContent align="end" width={240} sheetTitle={moreActionsLabel}>
              {moreActions.map((action) => (
                <Fragment key={action.id}>
                  {action.separatorBefore ? <DropdownMenuSeparator /> : null}
                  <CompactMoreAction action={action} />
                </Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </View>
      {modeBar ? <FileViewModeBar {...modeBar} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  commandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  primaryActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  moreTrigger: {
    padding: theme.spacing[1],
    borderRadius: 6,
  },
  moreTriggerActive: {
    backgroundColor: theme.colors.surfaceInteractiveHover,
  },
}));
