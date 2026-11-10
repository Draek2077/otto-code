import { createContext, useContext, type ReactNode } from "react";

const ScopedSheetHost = createContext(false);

/** Scoped sheets retain their owner's measured pane, including its clipping. */
export function VisualizerScopedSheets({ children }: { children: ReactNode }) {
  return <ScopedSheetHost.Provider value>{children}</ScopedSheetHost.Provider>;
}
export function useVisualizerScopedSheets() {
  return useContext(ScopedSheetHost);
}
