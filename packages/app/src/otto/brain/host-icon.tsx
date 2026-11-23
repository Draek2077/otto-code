import type { StyleProp, ViewStyle } from "react-native";
import { presentBrainSnapshot, type BrainUiBridge } from "./bridge";
import type { BrainPalette } from "./input";
import { BrainStateIcon } from "./state-icon";
import { useBrainUiSnapshot } from "./use-brain-ui";

export interface BrainHostIconProps {
  bridge: BrainUiBridge;
  palette: BrainPalette;
  size: number;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Wrap in BrainLifecycleProvider. The owning button uses presentation.label and navigation. */
export function BrainHostIcon({ bridge, palette, size, compact, style }: BrainHostIconProps) {
  const snapshot = useBrainUiSnapshot(bridge);
  const presentation = presentBrainSnapshot(snapshot);
  if (!presentation.visible) return null;
  return (
    <BrainStateIcon
      state={presentation.state}
      activity={presentation.activity}
      palette={palette}
      size={size}
      compact={compact}
      style={style}
    />
  );
}
