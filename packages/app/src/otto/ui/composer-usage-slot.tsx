import { createContext, useContext, type ReactNode } from "react";
const UsageSlot = createContext<ReactNode>(null);
export const ComposerUsageSlotProvider = UsageSlot.Provider;
/** One existing usage meter, placed directly before the current model control. */
export function ComposerUsageSlot() {
  return useContext(UsageSlot);
}
