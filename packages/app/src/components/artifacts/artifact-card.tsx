import { memo, useCallback, useState, type ReactElement } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Eye,
  FileText,
  MessageSquare,
  MoreVertical,
  Robot,
  Star,
  StarFilled,
  Trash2,
  TriangleAlert,
  X,
} from "@/components/icons/material-icons";
import { useHostFeature } from "@/runtime/host-features";
import type { Theme } from "@/styles/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BlobLoader, ThemedBlobLoader } from "@/components/blob-loader";
import { ExecutorRow, ProjectNameLine } from "@/components/project-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { AggregatedArtifact } from "@/artifacts/use-artifacts";

// Themed icon wrappers so menu icons can live as module-scope constants
// (avoids the react-perf jsx-as-prop rule) without calling useUnistyles in
// render - see docs/unistyles.md and the schedule-row precedent.
const ThemedEye = withUnistyles(Eye);
const ThemedFileText = withUnistyles(FileText);
const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedRobot = withUnistyles(Robot);
const ThemedX = withUnistyles(X);
const ThemedTrash2 = withUnistyles(Trash2);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

const MENU_ICON_SIZE = 14;

// Inner controls (star, kebab) sit inside the card's Pressable. Stopping the
// press-in here keeps a tap on them from also firing the card's edit action.
function stopPressInPropagation(event: { stopPropagation?: () => void }) {
  event.stopPropagation?.();
}

const viewLeading = <ThemedEye size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const chatLeading = <ThemedMessageSquare size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const editLeading = <ThemedFileText size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const regenerateLeading = <ThemedRobot size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const cancelLeading = <ThemedX size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const deleteLeading = <ThemedTrash2 size={MENU_ICON_SIZE} uniProps={destructiveColorMapping} />;

export interface ArtifactCardProps {
  artifact: AggregatedArtifact;
  /** Resolved project name for the artifact's stored project, when known. */
  projectName: string | null;
  /** Open a read-only preview dialog of the rendered artifact. */
  onView: (artifact: AggregatedArtifact) => void;
  /** Open a read-only view of the chat that generated the artifact. */
  onViewGenerationChat: (artifact: AggregatedArtifact) => void;
  /** Open the originating chat when the artifact was created from one. */
  onViewSourceChat: (artifact: AggregatedArtifact) => void;
  /** Open the edit dialog (also the card's primary click). */
  onEdit: (artifact: AggregatedArtifact) => void;
  /** Re-run generation with the stored config. */
  onRegenerate: (artifact: AggregatedArtifact) => void;
  /** Cancel an in-progress generation and recover the artifact. */
  onCancel: (artifact: AggregatedArtifact) => void;
  /** Restore the durable last good output after an invalid external edit. */
  onRepair: (artifact: AggregatedArtifact) => void;
  /** Change the explicit data contract without regenerating the artifact. */
  onUpdateData: (artifact: AggregatedArtifact) => void;
  onMove: (artifact: AggregatedArtifact, destination: "repository" | "host") => Promise<void>;
  /** A confirmed location move is in progress for this artifact. */
  isMoving: boolean;
  onStar: (artifact: AggregatedArtifact) => void;
  onDelete: (artifact: AggregatedArtifact) => void;
  showHost: boolean;
}

function formatDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return "";
  }
  return new Date(parsed).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function storageLocationLabel(location: AggregatedArtifact["storageLocation"]): string {
  switch (location) {
    case "repository":
      return "Repository";
    case "host":
      return "This host";
    default:
      return "Legacy location";
  }
}

function storageLocationDescription(location: AggregatedArtifact["storageLocation"]): string {
  switch (location) {
    case "repository":
      return "the repository";
    case "host":
      return "this host";
    default:
      return "its legacy location";
  }
}

function sourceLabel(source: NonNullable<AggregatedArtifact["source"]>): string {
  switch (source.kind) {
    case "chat":
      return "Chat";
    case "workflow":
      return "Workflow";
    case "schedule":
      return "Schedule";
  }
}

function ArtifactCardComponent({
  artifact,
  projectName,
  onView,
  onViewGenerationChat,
  onViewSourceChat,
  onEdit,
  onRegenerate,
  onCancel,
  onRepair,
  onUpdateData,
  onMove,
  isMoving,
  onStar,
  onDelete,
  showHost,
}: ArtifactCardProps) {
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  // The daemon only serves a closed generation agent's transcript when it
  // advertises retainedTranscripts; older hosts have no record to fetch.
  const canViewGenerationChat = useHostFeature(artifact.serverId, "retainedTranscripts");
  // COMPAT(artifactProvenance): added in v0.9.0, remove after 2027-02-28.
  const canViewSourceChat =
    useHostFeature(artifact.serverId, "artifactProvenance") && artifact.source?.kind === "chat";
  // COMPAT(artifactRepair): added in v0.9.0, remove after 2027-02-28.
  const canRepair = useHostFeature(artifact.serverId, "artifactRepair");
  // COMPAT(artifactDataUpdate): added in v0.9.0, remove after 2027-02-28.
  const canUpdateData = useHostFeature(artifact.serverId, "artifactDataUpdate");
  // COMPAT(artifactStoreMove): added in v0.9.0, remove after 2027-02-28.
  const canMove = useHostFeature(artifact.serverId, "artifactStoreMove");

  const handleView = useCallback(() => onView(artifact), [artifact, onView]);
  const handleViewGenerationChat = useCallback(
    () => onViewGenerationChat(artifact),
    [artifact, onViewGenerationChat],
  );
  const handleViewSourceChat = useCallback(
    () => onViewSourceChat(artifact),
    [artifact, onViewSourceChat],
  );
  const handleEdit = useCallback(() => onEdit(artifact), [artifact, onEdit]);
  const handleRegenerate = useCallback(() => onRegenerate(artifact), [artifact, onRegenerate]);
  const handleCancel = useCallback(() => onCancel(artifact), [artifact, onCancel]);
  const handleRepair = useCallback(() => onRepair(artifact), [artifact, onRepair]);
  const handleUpdateData = useCallback(() => onUpdateData(artifact), [artifact, onUpdateData]);
  const handleMove = useCallback(
    (destination: "repository" | "host") => {
      const destinationLabel = destination === "repository" ? "the repository" : "this host";
      const currentLocation = storageLocationDescription(artifact.storageLocation);
      void (async () => {
        const confirmed = await confirmDialog({
          title: "Move artifact",
          message: `Move "${artifact.name}" from ${currentLocation} to ${destinationLabel}? Its location changes, but its data and rendered output do not.`,
          confirmLabel: "Move",
        });
        if (confirmed) void onMove(artifact, destination);
      })();
    },
    [artifact, onMove],
  );
  const handleStar = useCallback(() => onStar(artifact), [artifact, onStar]);

  const handleDelete = useCallback(() => {
    void (async () => {
      const confirmed = await confirmDialog({
        title: "Delete artifact",
        message: `Delete "${artifact.name}"? This cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      });
      if (confirmed) {
        onDelete(artifact);
      }
    })();
  }, [artifact, onDelete]);

  const cardStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.card,
      artifact.status === "error" && styles.cardError,
      isHovered && !isCompact && styles.cardHovered,
      pressed && styles.cardPressed,
    ],
    [artifact.status, isHovered, isCompact],
  );

  return (
    <View
      style={styles.container}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        style={cardStyle}
        onPress={handleEdit}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${artifact.name}`}
        testID={`artifact-card-${artifact.id}`}
      >
        <View style={styles.headerRow}>
          <FileText size="md" color={styles.icon.color} />
          <Text style={styles.name} numberOfLines={1}>
            {artifact.name || artifact.id}
          </Text>
          <Pressable
            onPress={handleStar}
            onPressIn={stopPressInPropagation}
            hitSlop={8}
            style={headerActionStyle}
            // Web renders accessibilityRole="button" as a real <button>; this
            // Pressable lives inside the card's own button, so gate the role to
            // native to avoid an invalid nested <button> (matches the kebab
            // trigger below and schedule-row's pattern).
            accessibilityRole={isNative ? "button" : undefined}
            accessibilityLabel={artifact.starred ? "Unstar artifact" : "Star artifact"}
            testID={`artifact-star-${artifact.id}`}
          >
            {artifact.starred ? (
              <StarFilled size="mdPlus" color={styles.starOn.color} />
            ) : (
              <Star size="mdPlus" color={styles.icon.color} />
            )}
          </Pressable>
          <ArtifactKebabMenu
            artifact={artifact}
            canViewGenerationChat={canViewGenerationChat}
            onView={handleView}
            onViewGenerationChat={handleViewGenerationChat}
            onViewSourceChat={handleViewSourceChat}
            canViewSourceChat={canViewSourceChat}
            onEdit={handleEdit}
            onRegenerate={handleRegenerate}
            onCancel={handleCancel}
            onRepair={handleRepair}
            canRepair={canRepair}
            onUpdateData={handleUpdateData}
            canUpdateData={canUpdateData}
            canMove={canMove}
            isMoving={isMoving}
            onMove={handleMove}
            onDelete={handleDelete}
          />
        </View>

        <ExecutorRow
          serverId={artifact.serverId}
          personalityName={artifact.generationPersonalityName ?? null}
          provider={artifact.generationProvider}
          model={artifact.generationModel}
        />
        <ProjectNameLine projectName={projectName} />
        <ArtifactStorageLine location={artifact.storageLocation} />
        <ArtifactSourceLine source={artifact.source} />

        {isMoving ? <Text style={styles.movingText}>Moving artifact…</Text> : null}

        {artifact.status === "error" ? (
          <View style={styles.statusRow}>
            <TriangleAlert size="sm" color={styles.errorText.color} />
            <Text style={styles.errorText} numberOfLines={2}>
              {artifact.errorMessage ?? "Generation failed"}
            </Text>
          </View>
        ) : null}

        {/* Spacer pins the footer to the bottom of the card. */}
        <View style={styles.spacer} />

        <View style={styles.footerRow}>
          <ArtifactStatusBadge artifact={artifact} />
          <View style={styles.footerMeta}>
            {showHost ? (
              <Text style={styles.metaText} numberOfLines={1}>
                {artifact.serverName}
              </Text>
            ) : null}
            <Text style={styles.metaText}>{formatDate(artifact.updatedAt)}</Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

function ArtifactStorageLine({ location }: { location: AggregatedArtifact["storageLocation"] }) {
  return (
    <Text style={styles.storageText} testID="artifact-storage-location">
      Stored: {storageLocationLabel(location)}
    </Text>
  );
}

function ArtifactSourceLine({ source }: { source: AggregatedArtifact["source"] }) {
  if (!source) return null;
  return <Text style={styles.storageText}>Source: {sourceLabel(source)}</Text>;
}

interface ArtifactMoveMenuItemsProps {
  artifact: AggregatedArtifact;
  canMove: boolean;
  isMoving: boolean;
  onMove: (destination: "repository" | "host") => void;
}

function ArtifactMoveMenuItems({
  artifact,
  canMove,
  isMoving,
  onMove,
}: ArtifactMoveMenuItemsProps): ReactElement | null {
  const disabled = artifact.status === "generating" || isMoving;
  const handleMoveToRepository = useCallback(() => onMove("repository"), [onMove]);
  const handleMoveToHost = useCallback(() => onMove("host"), [onMove]);
  const destination = artifact.storageLocation === "repository" ? "host" : "repository";
  const handleMoveToOther = useCallback(() => onMove(destination), [destination, onMove]);

  if (!canMove) return null;

  if (artifact.storageLocation) {
    const destinationLabel = destination === "repository" ? "repository" : "this host";
    return (
      <DropdownMenuItem
        leading={editLeading}
        disabled={disabled}
        onSelect={disabled ? undefined : handleMoveToOther}
        testID={`artifact-menu-move-${artifact.id}`}
      >
        Move to {destinationLabel}
      </DropdownMenuItem>
    );
  }

  return (
    <>
      <DropdownMenuItem
        leading={editLeading}
        disabled={disabled}
        onSelect={disabled ? undefined : handleMoveToRepository}
        testID={`artifact-menu-move-repository-${artifact.id}`}
      >
        Move to repository
      </DropdownMenuItem>
      <DropdownMenuItem
        leading={editLeading}
        disabled={disabled}
        onSelect={disabled ? undefined : handleMoveToHost}
        testID={`artifact-menu-move-host-${artifact.id}`}
      >
        Move to this host
      </DropdownMenuItem>
    </>
  );
}

function ArtifactKebabMenu({
  artifact,
  canViewGenerationChat,
  onView,
  onViewGenerationChat,
  onViewSourceChat,
  canViewSourceChat,
  onEdit,
  onRegenerate,
  onCancel,
  onRepair,
  canRepair,
  onUpdateData,
  canUpdateData,
  onMove,
  canMove,
  isMoving,
  onDelete,
}: {
  artifact: AggregatedArtifact;
  canViewGenerationChat: boolean;
  onView: () => void;
  onViewGenerationChat: () => void;
  onViewSourceChat: () => void;
  canViewSourceChat: boolean;
  onEdit: () => void;
  onRegenerate: () => void;
  onCancel: () => void;
  onRepair: () => void;
  canRepair: boolean;
  onUpdateData: () => void;
  canUpdateData: boolean;
  onMove: (destination: "repository" | "host") => void;
  canMove: boolean;
  isMoving: boolean;
  onDelete: () => void;
}) {
  const isGenerating = artifact.status === "generating";
  // Only offer the transcript view once generation has produced an agent to
  // read and the host can serve its (closed) transcript.
  const showGenerationChat = canViewGenerationChat && Boolean(artifact.generationAgentId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        hitSlop={8}
        onPressIn={stopPressInPropagation}
        style={headerActionStyle}
        accessibilityRole={isNative ? "button" : undefined}
        accessibilityLabel="Artifact actions"
        testID={`artifact-menu-${artifact.id}`}
      >
        <MoreVertical size="mdPlus" color={styles.icon.color} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={200}>
        <DropdownMenuItem
          leading={viewLeading}
          disabled={isGenerating}
          onSelect={isGenerating ? undefined : onView}
          testID={`artifact-menu-view-${artifact.id}`}
        >
          View artifact
        </DropdownMenuItem>
        {showGenerationChat ? (
          <DropdownMenuItem
            leading={chatLeading}
            onSelect={onViewGenerationChat}
            testID={`artifact-menu-view-chat-${artifact.id}`}
          >
            View generation chat
          </DropdownMenuItem>
        ) : null}
        {canViewSourceChat ? (
          <DropdownMenuItem
            leading={chatLeading}
            onSelect={onViewSourceChat}
            testID={`artifact-menu-view-source-chat-${artifact.id}`}
          >
            View source chat
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          leading={editLeading}
          onSelect={onEdit}
          testID={`artifact-menu-edit-${artifact.id}`}
        >
          Edit
        </DropdownMenuItem>
        {isGenerating ? (
          <DropdownMenuItem
            leading={cancelLeading}
            onSelect={onCancel}
            testID={`artifact-menu-cancel-${artifact.id}`}
          >
            Cancel generation
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            leading={regenerateLeading}
            onSelect={onRegenerate}
            testID={`artifact-menu-regenerate-${artifact.id}`}
          >
            Regenerate
          </DropdownMenuItem>
        )}
        {canRepair && artifact.repairAvailable ? (
          <DropdownMenuItem
            leading={editLeading}
            onSelect={onRepair}
            testID={`artifact-menu-repair-${artifact.id}`}
          >
            Repair last good output
          </DropdownMenuItem>
        ) : null}
        {canUpdateData ? (
          <DropdownMenuItem
            leading={editLeading}
            disabled={isGenerating}
            onSelect={isGenerating ? undefined : onUpdateData}
            testID={`artifact-menu-update-data-${artifact.id}`}
          >
            Update data
          </DropdownMenuItem>
        ) : null}
        <ArtifactMoveMenuItems
          artifact={artifact}
          canMove={canMove}
          isMoving={isMoving}
          onMove={onMove}
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          leading={deleteLeading}
          destructive
          onSelect={onDelete}
          testID={`artifact-menu-delete-${artifact.id}`}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Chrome for the header's inline controls (star, kebab). The hovered card is
// already surface2, so the control's own hover/press states step up to
// surface3/surface4 - anything lower is invisible against the card.
function headerActionStyle({
  hovered = false,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.headerAction,
    hovered && styles.headerActionHovered,
    pressed && styles.headerActionPressed,
  ];
}

/** Left slot of the footer row: always the state pill (same shape as
 * Schedules/Orchestrations), so every card reads the same way at a glance. */
function ArtifactStatusBadge({ artifact }: { artifact: AggregatedArtifact }) {
  if (artifact.status === "generating") {
    // Render in the generating personality's spinner identity when it was
    // snapshotted at create time; otherwise fall back to the theme's colors.
    const spinner = artifact.generationSpinner;
    return (
      <View style={styles.statusRow}>
        {spinner ? (
          <BlobLoader size="md" glowA={spinner.glowA} glowB={spinner.glowB} />
        ) : (
          <ThemedBlobLoader size="md" />
        )}
        <StatusBadge label="Generating" variant="warning" />
      </View>
    );
  }
  if (artifact.status === "error") {
    return <StatusBadge label="Failed" variant="error" />;
  }
  return <StatusBadge label="Ready" variant="success" />;
}

export const ArtifactCard = memo(ArtifactCardComponent);

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "relative",
    flex: 1,
  },
  card: {
    flex: 1,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[4],
    gap: theme.spacing[2],
    minHeight: 132,
  },
  storageText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  cardError: {
    borderColor: theme.colors.palette.red[500],
  },
  cardHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  cardPressed: {
    backgroundColor: theme.colors.surface3,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  name: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  spacer: {
    flex: 1,
    minHeight: theme.spacing[2],
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  footerMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
  },
  metaText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  errorText: {
    color: theme.colors.palette.red[500],
    fontSize: theme.fontSize.xs,
    flexShrink: 1,
  },
  movingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  icon: {
    color: theme.colors.foregroundMuted,
  },
  starOn: {
    color: theme.colors.palette.yellow[400],
  },
  headerAction: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  headerActionHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  headerActionPressed: {
    backgroundColor: theme.colors.surface4,
  },
}));
