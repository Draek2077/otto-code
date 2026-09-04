import { useMemo } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolveBottomSafeAreaPadding } from "./bottom-safe-area-padding";

/** A stable bottom-padding style for the bottom-most owner of a surface. */
export function useBottomSafeAreaPadding(basePadding = 0): { paddingBottom: number } {
  const insets = useSafeAreaInsets();
  return useMemo(
    () => ({
      paddingBottom: resolveBottomSafeAreaPadding({
        basePadding,
        safeAreaBottom: insets.bottom,
      }),
    }),
    [basePadding, insets.bottom],
  );
}
