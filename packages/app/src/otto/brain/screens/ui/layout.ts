import { useWindowDimensions } from "react-native";
/** The frozen Overview stacked its top tiles only below the sm breakpoint. */
export function useIsExtraCompactFormFactor(): boolean {
  return useWindowDimensions().width < 576;
}
