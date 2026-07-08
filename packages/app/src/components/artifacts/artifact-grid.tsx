import { type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ArtifactCard } from "@/components/artifacts/artifact-card";
import type { AggregatedArtifact } from "@/artifacts/use-artifacts";

export interface ArtifactGridProps {
  artifacts: AggregatedArtifact[];
  showHost: boolean;
  onEdit: (artifact: AggregatedArtifact) => void;
  onRegenerate: (artifact: AggregatedArtifact) => void;
  onCancel: (artifact: AggregatedArtifact) => void;
  onStar: (artifact: AggregatedArtifact) => void;
  onDelete: (artifact: AggregatedArtifact) => void;
}

export function ArtifactGrid({
  artifacts,
  showHost,
  onEdit,
  onRegenerate,
  onCancel,
  onStar,
  onDelete,
}: ArtifactGridProps): ReactElement {
  const isCompact = useIsCompactFormFactor();
  return (
    <View style={styles.grid}>
      {artifacts.map((artifact) => (
        <View
          key={`${artifact.serverId}:${artifact.id}`}
          style={isCompact ? styles.cellFull : styles.cellHalf}
        >
          <ArtifactCard
            artifact={artifact}
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
  cellFull: {
    width: "100%",
  },
  cellHalf: {
    flexGrow: 1,
    flexBasis: "48%",
    maxWidth: "50%",
  },
}));
