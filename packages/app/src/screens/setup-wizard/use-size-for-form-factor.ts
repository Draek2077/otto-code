import { useCallback } from "react";

import { useIsCompactFormFactor, useIsExtraCompactFormFactor } from "@/constants/layout";

/**
 * Width-tier size picker for the wizard's brand bookends: returns a selector
 * that resolves a dimension for the current form factor (extra-compact phones
 * < compact tablets/small windows < wide desktop). Shared by the Welcome and
 * Done steps so their hero glyph/ring scale on the same breakpoints.
 */
export function useSizeForFormFactor(): (
  extraCompact: number,
  compact: number,
  wide: number,
) => number {
  const isCompact = useIsCompactFormFactor();
  const isExtraCompact = useIsExtraCompactFormFactor();
  return useCallback(
    (extraCompact: number, compact: number, wide: number) => {
      if (isExtraCompact) return extraCompact;
      if (isCompact) return compact;
      return wide;
    },
    [isCompact, isExtraCompact],
  );
}
