import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { FileText, Plus } from "@/components/icons/material-icons";
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
import { artifactBelongsToWorkspace } from "@/artifacts/artifact-derivation";
import { useHostFeature } from "@/runtime/host-features";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";

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
  // Fetch all artifacts on the host and match them to this workspace by path
  // (repo root vs. worktree), not by an exact server-side projectId filter —
  // the stored projectId is the repo root while cwd may be a worktree path with
  // OS-native separators, so an exact match would drop legitimate artifacts.
  const { artifacts } = useArtifacts();
  const isCompact = useIsCompactFormFactor();
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

  const projectArtifacts = useMemo(
    () =>
      artifacts.filter(
        (artifact) =>
          artifact.serverId === serverId && artifactBelongsToWorkspace(artifact.projectId, cwd),
      ),
    [artifacts, serverId, cwd],
  );

  const handleOpen = useCallback(
    (artifactId: string) => {
      openArtifactTab({ serverId, workspaceId, artifactId });
    },
    [serverId, workspaceId],
  );

  // Once the just-created artifact reports ready, open it as a tab.
  useEffect(() => {
    if (!pendingOpenId) {
      return;
    }
    const ready = projectArtifacts.find(
      (artifact) => artifact.id === pendingOpenId && artifact.status === "ready",
    );
    if (ready) {
      setPendingOpenId(null);
      handleOpen(ready.id);
    }
  }, [pendingOpenId, projectArtifacts, handleOpen]);

  const handleCreated = useCallback((input: { artifact: { id: string } }) => {
    setPendingOpenId(input.artifact.id);
  }, []);

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
  const isReady = artifact.status === "ready";
  const handleSelect = useCallback(() => {
    onOpen(artifact.id);
  }, [artifact.id, onOpen]);
  return (
    <ContextMenuItem
      testID={`workspace-open-artifact-${artifact.id}`}
      disabled={!isReady}
      onSelect={isReady ? handleSelect : undefined}
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
  const isReady = artifact.status === "ready";
  const handleSelect = useCallback(() => {
    onOpen(artifact.id);
  }, [artifact.id, onOpen]);
  return (
    <DropdownMenuItem
      testID={`workspace-open-artifact-${artifact.id}`}
      disabled={!isReady}
      onSelect={isReady ? handleSelect : undefined}
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
  hiddenTrigger: {
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
