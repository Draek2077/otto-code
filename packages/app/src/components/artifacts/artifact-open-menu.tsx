import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Text } from "react-native";
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
}

export function ArtifactOpenMenu({
  serverId,
  workspaceId,
}: ArtifactOpenMenuProps): ReactElement | null {
  const supportsArtifacts = useHostFeature(serverId, "artifacts");
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  // Fetch all artifacts on the host and match them to this workspace by path
  // (repo root vs. worktree), not by an exact server-side projectId filter —
  // the stored projectId is the repo root while cwd may be a worktree path with
  // OS-native separators, so an exact match would drop legitimate artifacts.
  const { artifacts } = useArtifacts();
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

  return (
    <>
      <DropdownMenu>
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="triggerRef">
            <DropdownMenuTrigger
              testID="workspace-open-artifact-trigger"
              accessibilityRole="button"
              accessibilityLabel="Open artifact"
              style={styles.trigger}
            >
              <FileText size={16} color={styles.icon.color} />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <Text style={styles.tooltipText}>Artifacts</Text>
          </TooltipContent>
        </Tooltip>
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
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  icon: {
    color: theme.colors.foregroundMuted,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
}));
