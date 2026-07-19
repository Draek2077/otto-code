import { memo, useCallback, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Eye,
  FileText,
  MessageSquare,
  MoreVertical,
  RotateCw,
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

// Themed lucide wrappers so menu icons can live as module-scope constants
// (avoids the react-perf jsx-as-prop rule) without calling useUnistyles in
// render — see docs/unistyles.md and the schedule-row precedent.
const ThemedEye = withUnistyles(Eye);
const ThemedFileText = withUnistyles(FileText);
const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedRotateCw = withUnistyles(RotateCw);
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
const regenerateLeading = <ThemedRotateCw size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
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
  /** Open the edit dialog (also the card's primary click). */
  onEdit: (artifact: AggregatedArtifact) => void;
  /** Re-run generation with the stored config. */
  onRegenerate: (artifact: AggregatedArtifact) => void;
  /** Cancel an in-progress generation and recover the artifact. */
  onCancel: (artifact: AggregatedArtifact) => void;
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

function ArtifactCardComponent({
  artifact,
  projectName,
  onView,
  onViewGenerationChat,
  onEdit,
  onRegenerate,
  onCancel,
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

  const handleView = useCallback(() => onView(artifact), [artifact, onView]);
  const handleViewGenerationChat = useCallback(
    () => onViewGenerationChat(artifact),
    [artifact, onViewGenerationChat],
  );
  const handleEdit = useCallback(() => onEdit(artifact), [artifact, onEdit]);
  const handleRegenerate = useCallback(() => onRegenerate(artifact), [artifact, onRegenerate]);
  const handleCancel = useCallback(() => onCancel(artifact), [artifact, onCancel]);
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
          <FileText size={16} color={styles.icon.color} />
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
              <StarFilled size={18} color={styles.starOn.color} />
            ) : (
              <Star size={18} color={styles.icon.color} />
            )}
          </Pressable>
          <ArtifactKebabMenu
            artifact={artifact}
            canViewGenerationChat={canViewGenerationChat}
            onView={handleView}
            onViewGenerationChat={handleViewGenerationChat}
            onEdit={handleEdit}
            onRegenerate={handleRegenerate}
            onCancel={handleCancel}
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

        {artifact.status === "error" ? (
          <View style={styles.statusRow}>
            <TriangleAlert size={14} color={styles.errorText.color} />
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

function ArtifactKebabMenu({
  artifact,
  canViewGenerationChat,
  onView,
  onViewGenerationChat,
  onEdit,
  onRegenerate,
  onCancel,
  onDelete,
}: {
  artifact: AggregatedArtifact;
  canViewGenerationChat: boolean;
  onView: () => void;
  onViewGenerationChat: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  onCancel: () => void;
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
        <MoreVertical size={18} color={styles.icon.color} />
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
// surface3/surface4 — anything lower is invisible against the card.
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
          <BlobLoader size={16} glowA={spinner.glowA} glowB={spinner.glowB} />
        ) : (
          <ThemedBlobLoader size={16} />
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
