import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { FileText, Plus, TriangleAlert } from "@/components/icons/material-icons";
import { ThemedBlobLoader } from "@/components/blob-loader";
import type { Theme } from "@/styles/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  useContextMenu,
} from "@/components/ui/context-menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ArtifactCreateSheet } from "@/components/artifacts/artifact-create-sheet";
import { useArtifacts, type AggregatedArtifact } from "@/artifacts/use-artifacts";
import { openArtifactTab } from "@/artifacts/open-artifact-tab";
import { artifactMatchesWorkspace } from "@/artifacts/artifact-derivation";
import { useHostFeature } from "@/runtime/host-features";
import { useWorkspaceDirectory, useWorkspaceProjectId } from "@/stores/session-store-hooks";

export interface ArtifactOpenMenuProps {
  serverId: string;
  workspaceId: string;
  /** Controlled open state, so a collapsed trigger elsewhere can open the menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Render only a zero-size anchor instead of the toolbar button. Used when
   * the tab bar collapses this tool into the more-actions menu: the menu item
   * there flips the controlled `open` on, and the dropdown anchors here.
   */
  hideTrigger?: boolean;
}

const ThemedTriangleAlert = withUnistyles(TriangleAlert);
const generatingLeading = <ThemedBlobLoader size={14} />;
const errorLeadingColorMapping = (theme: Theme) => ({ color: theme.colors.palette.red[500] });
const errorLeading = <ThemedTriangleAlert size={14} uniProps={errorLeadingColorMapping} />;

function menuItemLeading(status: AggregatedArtifact["status"]): ReactElement | undefined {
  if (status === "generating") {
    return generatingLeading;
  }
  if (status === "error") {
    return errorLeading;
  }
  return undefined;
}

function triggerStyle({
  hovered,
  pressed,
  open,
}: {
  hovered: boolean;
  pressed: boolean;
  open: boolean;
}) {
  return [styles.trigger, (hovered || pressed || open) && styles.triggerHovered];
}

export function ArtifactOpenMenu({
  serverId,
  workspaceId,
  open,
  onOpenChange,
  hideTrigger = false,
}: ArtifactOpenMenuProps): ReactElement | null {
  const supportsArtifacts = useHostFeature(serverId, "artifacts");
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const projectId = useWorkspaceProjectId(serverId, workspaceId);
  // Fetch all artifacts on the host and match them to this workspace by path
  // (repo root vs. worktree) with a legacy grouping-key fallback — see
  // artifactMatchesWorkspace.
  const { artifacts } = useArtifacts();
  const isCompact = useIsCompactFormFactor();
  const [createOpen, setCreateOpen] = useState(false);

  const projectArtifacts = useMemo(
    () =>
      artifacts.filter(
        (artifact) =>
          artifact.serverId === serverId &&
          artifactMatchesWorkspace({
            artifactProjectId: artifact.projectId,
            workspaceCwd: cwd,
            workspaceProjectId: projectId,
          }),
      ),
    [artifacts, serverId, cwd, projectId],
  );

  const handleOpen = useCallback(
    (artifactId: string) => {
      openArtifactTab({ serverId, workspaceId, artifactId });
    },
    [serverId, workspaceId],
  );

  // Open the tab as soon as the artifact record exists, without waiting for
  // generation to finish — the tab shows a generating spinner and a link back
  // to the agent session (see ArtifactPanel) until content is ready.
  const handleCreated = useCallback(
    (input: { artifact: { id: string } }) => {
      handleOpen(input.artifact.id);
    },
    [handleOpen],
  );

  const handleOpenCreate = useCallback(() => setCreateOpen(true), []);
  const handleCloseCreate = useCallback(() => setCreateOpen(false), []);
  const createLeading = useMemo(() => <Plus size={16} color={styles.icon.color} />, []);

  if (!supportsArtifacts) {
    return null;
  }

  // Compact form factors get a bottom sheet instead of a dropdown anchored to
  // a (possibly hidden zero-size) trigger — the header "..." menu item flips
  // `open` on and the sheet slides up with the same artifact list + create row.
  if (isCompact) {
    return (
      <>
        <ContextMenu open={open} onOpenChange={onOpenChange}>
          {hideTrigger ? null : <ArtifactSheetTriggerButton />}
          <ContextMenuContent mobileMode="sheet" testID="workspace-open-artifact-sheet">
            {projectArtifacts.length > 0 ? (
              <>
                <ContextMenuLabel>Artifacts</ContextMenuLabel>
                {projectArtifacts.map((artifact) => (
                  <ArtifactSheetItem key={artifact.id} artifact={artifact} onOpen={handleOpen} />
                ))}
                <ContextMenuSeparator />
              </>
            ) : null}
            <ContextMenuItem
              testID="workspace-open-artifact-create"
              leading={createLeading}
              onSelect={handleOpenCreate}
            >
              Create artifact
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <ArtifactCreateSheet
          visible={createOpen}
          onClose={handleCloseCreate}
          initialServerId={serverId}
          initialProjectCwd={cwd ?? undefined}
          onCreated={handleCreated}
        />
      </>
    );
  }

  const trigger = hideTrigger ? (
    <DropdownMenuTrigger
      testID="workspace-open-artifact-trigger"
      disabled
      accessibilityElementsHidden
      style={styles.hiddenTrigger}
    >
      <View />
    </DropdownMenuTrigger>
  ) : (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="triggerRef">
        <DropdownMenuTrigger
          testID="workspace-open-artifact-trigger"
          accessibilityRole="button"
          accessibilityLabel="Add artifact"
          style={triggerStyle}
        >
          <FileText size={14} color={styles.icon.color} />
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>Add artifact</Text>
      </TooltipContent>
    </Tooltip>
  );

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        {trigger}
        <DropdownMenuContent side="bottom" align="end" offset={4} minWidth={220}>
          {projectArtifacts.length > 0 ? (
            <>
              <DropdownMenuLabel>Artifacts</DropdownMenuLabel>
              {projectArtifacts.map((artifact) => (
                <ArtifactMenuItem key={artifact.id} artifact={artifact} onOpen={handleOpen} />
              ))}
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem
            testID="workspace-open-artifact-create"
            leading={createLeading}
            onSelect={handleOpenCreate}
          >
            Create artifact
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ArtifactCreateSheet
        visible={createOpen}
        onClose={handleCloseCreate}
        initialServerId={serverId}
        initialProjectCwd={cwd ?? undefined}
        onCreated={handleCreated}
      />
    </>
  );
}

// Plain-press trigger for the compact sheet — ContextMenuTrigger only opens on
// long-press/right-click, but this toolbar button should open on tap.
function ArtifactSheetTriggerButton(): ReactElement {
  const { open, setOpen } = useContextMenu();
  const handlePress = useCallback(() => setOpen(true), [setOpen]);
  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) =>
      triggerStyle({ hovered, pressed, open }),
    [open],
  );
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="triggerRef">
        <Pressable
          testID="workspace-open-artifact-trigger"
          accessibilityRole="button"
          accessibilityLabel="Add artifact"
          onPress={handlePress}
          style={pressableStyle}
        >
          <FileText size={14} color={styles.icon.color} />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <Text style={styles.tooltipText}>Add artifact</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function ArtifactSheetItem({
  artifact,
  onOpen,
}: {
  artifact: AggregatedArtifact;
  onOpen: (artifactId: string) => void;
}): ReactElement {
  // Every status is openable: generating shows a spinner and a link to the
  // generating agent session, and a failed generation shows the failure (or
  // falls back to the last successful content, if any) — see ArtifactPanel.
  const handleSelect = useCallback(() => {
    onOpen(artifact.id);
  }, [artifact.id, onOpen]);
  return (
    <ContextMenuItem
      testID={`workspace-open-artifact-${artifact.id}`}
      leading={menuItemLeading(artifact.status)}
      onSelect={handleSelect}
    >
      {artifact.name || artifact.id}
    </ContextMenuItem>
  );
}

function ArtifactMenuItem({
  artifact,
  onOpen,
}: {
  artifact: AggregatedArtifact;
  onOpen: (artifactId: string) => void;
}): ReactElement {
  // Every status is openable: generating shows a spinner and a link to the
  // generating agent session, and a failed generation shows the failure (or
  // falls back to the last successful content, if any) — see ArtifactPanel.
  const handleSelect = useCallback(() => {
    onOpen(artifact.id);
  }, [artifact.id, onOpen]);
  return (
    <DropdownMenuItem
      testID={`workspace-open-artifact-${artifact.id}`}
      leading={menuItemLeading(artifact.status)}
      onSelect={handleSelect}
    >
      {artifact.name || artifact.id}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  // Zero-size anchor for the collapsed mode — exists only so the dropdown has
  // a position to open from; must never take layout space or catch pointers.
  // `position: absolute` keeps it out of flex flow: a zero-size *flex item* still
  // consumes a `gap` slot on both sides, which would silently double the gap
  // between its siblings (e.g. the header "..." menu and the Visualizer button).
  hiddenTrigger: {
    position: "absolute",
    width: 0,
    height: 0,
    opacity: 0,
    overflow: "hidden",
  },
  icon: {
    color: theme.colors.foregroundMuted,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
}));
