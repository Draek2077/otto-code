import { createContext, useContext, type ReactNode } from "react";
import type { ComposerControlPresentation } from "@/composer/agent-controls/layout";

interface ComposerControlLayoutValue {
  presentation: ComposerControlPresentation;
}

const DEFAULT_LAYOUT: ComposerControlLayoutValue = {
  presentation: {
    showModelLabel: true,
    showThinkingLabel: true,
    showModeLabel: true,
    showFeatureLabels: true,
  },
};

const ComposerControlLayoutContext = createContext(DEFAULT_LAYOUT);

export function ComposerControlLayoutProvider({
  value,
  children,
}: {
  value: ComposerControlLayoutValue;
  children: ReactNode;
}) {
  return (
    <ComposerControlLayoutContext.Provider value={value}>
      {children}
    </ComposerControlLayoutContext.Provider>
  );
}

export function useComposerControlLayout(): ComposerControlLayoutValue {
  return useContext(ComposerControlLayoutContext);
}
