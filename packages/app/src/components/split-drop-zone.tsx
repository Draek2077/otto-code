import { useMemo, type Ref } from "react";
import { useDroppable } from "@dnd-kit/core";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { PaneOverlay } from "@/components/ui/pane-overlay";

export type SplitDropZonePosition = "center" | "left" | "right" | "top" | "bottom";

export interface SplitDropZoneHover {
  paneId: string;
  position: SplitDropZonePosition;
}

export interface SplitDropZoneProps {
  paneId: string;
  active: boolean;
  preview: SplitDropZoneHover | null;
}

const EDGE_RATIO = 0.15;
const CENTER_RATIO = 0.4;

export function buildSplitDropZoneId(paneId: string): string {
  return `split-pane-drop:${paneId}`;
}

export function SplitDropZone({ paneId, active, preview }: SplitDropZoneProps) {
  const { setNodeRef } = useDroppable({
    id: buildSplitDropZoneId(paneId),
    disabled: !active,
    data: {
      kind: "split-pane-drop",
      paneId,
    },
  });

  const previewStyles = useMemo(() => {
    if (!preview || preview.paneId !== paneId) {
      return null;
    }
    return {
      overlay: [styles.previewOverlay, getPreviewOverlayStyle(preview.position)],
      frame: [styles.previewFrame, getPreviewFrameStyle(preview.position)],
    };
  }, [paneId, preview]);

  if (!active) {
    return null;
  }

  return (
    <View ref={setNodeRef as unknown as Ref<View>} style={styles.overlay} pointerEvents="none">
      <PaneOverlay pointerEvents="none" clip>
        {previewStyles ? (
          <>
            <View pointerEvents="none" style={previewStyles.overlay} />
            <View pointerEvents="none" style={previewStyles.frame} />
          </>
        ) : null}
      </PaneOverlay>
    </View>
  );
}

export function resolveSplitDropPosition(input: {
  width: number;
  height: number;
  x: number;
  y: number;
}): SplitDropZonePosition {
  const centerInsetX = input.width * ((1 - CENTER_RATIO) / 2);
  const centerInsetY = input.height * ((1 - CENTER_RATIO) / 2);
  const insideCenterX = input.x >= centerInsetX && input.x <= input.width - centerInsetX;
  const insideCenterY = input.y >= centerInsetY && input.y <= input.height - centerInsetY;

  if (insideCenterX && insideCenterY) {
    return "center";
  }

  const edgeThresholdX = input.width * EDGE_RATIO;
  const edgeThresholdY = input.height * EDGE_RATIO;
  if (input.x <= edgeThresholdX) {
    return "left";
  }
  if (input.x >= input.width - edgeThresholdX) {
    return "right";
  }
  if (input.y <= edgeThresholdY) {
    return "top";
  }
  if (input.y >= input.height - edgeThresholdY) {
    return "bottom";
  }

  const distances = [
    { position: "left", distance: input.x },
    { position: "right", distance: input.width - input.x },
    { position: "top", distance: input.y },
    { position: "bottom", distance: input.height - input.y },
  ] satisfies Array<{ position: Exclude<SplitDropZonePosition, "center">; distance: number }>;
  distances.sort((left, right) => left.distance - right.distance);
  return distances[0]?.position ?? "center";
}

function getPreviewOverlayStyle(position: SplitDropZonePosition) {
  if (position === "left") {
    return styles.previewLeft;
  }
  if (position === "right") {
    return styles.previewRight;
  }
  if (position === "top") {
    return styles.previewTop;
  }
  if (position === "bottom") {
    return styles.previewBottom;
  }
  return styles.previewCenterOverlay;
}

function getPreviewFrameStyle(position: SplitDropZonePosition) {
  if (position === "left") {
    return styles.previewLeft;
  }
  if (position === "right") {
    return styles.previewRight;
  }
  if (position === "top") {
    return styles.previewTop;
  }
  if (position === "bottom") {
    return styles.previewBottom;
  }
  return styles.previewCenterFrame;
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 40,
  },
  previewOverlay: {
    backgroundColor: theme.colors.accent,
    opacity: 0.6,
    position: "absolute",
    borderRadius: theme.borderRadius.md,
  },
  previewFrame: {
    borderColor: theme.colors.accent,
    position: "absolute",
    borderRadius: theme.borderRadius.md,
    borderWidth: 2,
  },
  previewLeft: {
    left: 0,
    top: 0,
    bottom: 0,
    width: "50%",
  },
  previewRight: {
    right: 0,
    top: 0,
    bottom: 0,
    width: "50%",
  },
  previewTop: {
    left: 0,
    top: 0,
    right: 0,
    height: "50%",
  },
  previewBottom: {
    left: 0,
    right: 0,
    bottom: 0,
    height: "50%",
  },
  previewCenterOverlay: {
    left: theme.spacing[2],
    top: theme.spacing[2],
    right: theme.spacing[2],
    bottom: theme.spacing[2],
  },
  previewCenterFrame: {
    left: theme.spacing[2],
    top: theme.spacing[2],
    right: theme.spacing[2],
    bottom: theme.spacing[2],
  },
}));
