import type { WorkspaceTabTarget } from "@/stores/workspace-tabs-store";

// The gated-feature registry. A "feature" here is an optional, self-contained
// subsystem the user can turn off entirely — not just hidden from the UI, but
// kept out of memory: its panel module sits behind a React.lazy boundary, so a
// disabled feature's code is never import()-ed (see visualizer-panel-
// registration.tsx). The founding member is the Visualizer; more slot in by
// adding a FeatureId + a catalog entry.
//
// This is a LEAF module: it imports only the WorkspaceTabTarget kind TYPE (which
// erases at runtime), so it can be imported by settings storage without a cycle.
export type FeatureId = "visualizer";

export const FEATURE_IDS: readonly FeatureId[] = ["visualizer"];

export interface FeatureDefinition {
  id: FeatureId;
  /** Human-facing name. Raw English — the toggles live in the developer-mode-
   *  only settings surfaces, which are themselves raw English pending a
   *  translation pass (see screens/settings/visualizer-section.tsx). */
  label: string;
  /** One-line description shown beside the enable toggle. */
  description: string;
  /** The workspace tab kinds this feature owns. When the feature is disabled,
   *  tabs of these kinds are reaped (useCloseDisabledFeatureTabs) and their
   *  panels render a light "turned off" placeholder instead of loading. */
  panelKinds: readonly WorkspaceTabTarget["kind"][];
  /** Enabled state when the user has expressed no preference (missing key). */
  defaultEnabled: boolean;
}

export const FEATURE_CATALOG: Record<FeatureId, FeatureDefinition> = {
  visualizer: {
    id: "visualizer",
    label: "Visualizer",
    description:
      "The live agent-orchestration graph. Turning it off removes the header button, the Runs “Visualize” action, and its settings — and keeps its render bundle from ever loading into memory.",
    panelKinds: ["visualizer"],
    defaultEnabled: true,
  },
};
