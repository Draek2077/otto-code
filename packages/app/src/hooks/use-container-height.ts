import { useCallback, useState } from "react";
import type { LayoutChangeEvent } from "react-native";

/** Height changes smaller than this don't re-render the subtree being measured. */
const DEFAULT_STEP = 8;

/**
 * Tracks the height of a container via onLayout, quantized so ordinary layout
 * churn doesn't re-render everything under it. Measure a box whose height is set
 * by its own parent — measuring a content-sized box and feeding the result back
 * into that content's size is a loop.
 */
export function useContainerHeight(options?: { step?: number }): {
  onLayout: (e: LayoutChangeEvent) => void;
  height: number;
} {
  const step = options?.step ?? DEFAULT_STEP;
  const [height, setHeight] = useState(0);
  return {
    onLayout: useCallback(
      (e: LayoutChangeEvent) => {
        const next = e.nativeEvent.layout.height;
        if (next <= 0) {
          return;
        }
        setHeight((current) => (Math.abs(current - next) < step ? current : next));
      },
      [step],
    ),
    height,
  };
}
