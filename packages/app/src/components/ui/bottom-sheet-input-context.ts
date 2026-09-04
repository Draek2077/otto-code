import { createContext, useContext } from "react";

/**
 * A compact layout is not necessarily a bottom sheet: full-screen routes, including plugin
 * surfaces, use the same phone breakpoint. Keep this signal at the sheet host so text fields
 * select Gorhom's context-dependent input only when that host actually owns them.
 */
export const BottomSheetInputContext = createContext(false);

export function useBottomSheetInput(): boolean {
  return useContext(BottomSheetInputContext);
}
