import { type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ArtifactCard } from "@/components/artifacts/artifact-card";
import { describeScheduleCwd } from "@/schedules/schedule-project-targets";
import type { AggregatedArtifact } from "@/artifacts/use-artifacts";

export interface ArtifactGridProps {
  artifacts: AggregatedArtifact[];
  showHost: boolean;
  /** Known project roots keyed by `${serverId}:${cwd}`, for the project row. */
  projectNameByCwd: ReadonlyMap<string, string>;
  onEdit: (artifact: AggregatedArtifact) => void;
  onRegenerate: (artifact: AggregatedArtifact) => void;
  onCancel: (artifact: AggregatedArtifact) => void;
  onStar: (artifact: AggregatedArtifact) => void;
  onDelete: (artifact: AggregatedArtifact) => void;
}

export function ArtifactGrid({
  artifacts,
  showHost,
  projectNameByCwd,
  onEdit,
  onRegenerate,
  onCancel,
  onStar,
  onDelete,
}: ArtifactGridProps): ReactElement {
  return (
    <View style={styles.grid}>
      {artifacts.map((artifact) => (
        <View key={`${artifact.serverId}:${artifact.id}`} style={styles.cell}>
          <ArtifactCard
            artifact={artifact}
            projectName={describeScheduleCwd({
              serverId: artifact.serverId,
              cwd: artifact.projectId,
              projectNameByCwd,
            })}
            onEdit={onEdit}
            onRegenerate={onRegenerate}
            onCancel={onCancel}
            onStar={onStar}
            onDelete={onDelete}
            showHost={showHost}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
  },
  // 1 col until there's real room -> 2 cols (lg, 992px+) -> 3 cols (xl,
  // 1200px+), narrower/portrait-like cards versus Schedules' wider 1-2 col
  // cell (schedule-grid.tsx). Pushed a tier higher than the raw breakpoint
  // names suggest so cards don't cram in before there's actually space.
  cell: {
    flexGrow: 1,
    flexBasis: { xs: "100%", lg: "48%", xl: "31%" },
    maxWidth: { xs: "100%", lg: "50%", xl: "33%" },
  },
}));
