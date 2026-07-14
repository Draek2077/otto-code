import type { ComponentProps, ReactElement } from "react";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import type { RolePersonality } from "@/provider-selection/role-model-personality";

// The model-half of CombinedModelSelector — everything except the personality
// props, which this component owns via the unified RolePersonality contract.
type ModelHalfProps = Omit<
  ComponentProps<typeof CombinedModelSelector>,
  | "personalities"
  | "selectedPersonalityId"
  | "onSelectPersonality"
  | "onClearPersonality"
  | "onSelectModelOverPersonality"
>;

export interface RoleModelSelectorProps extends ModelHalfProps {
  /**
   * The role's personality selection, from a producer hook
   * (useFormRolePersonality / useAgentRolePersonality). Pass null for a plain
   * model picker with no personalities section.
   */
  personality: RolePersonality | null;
}

/**
 * The one model + personality picker every surface renders. It forwards the
 * model-half props to CombinedModelSelector and spreads the unified
 * RolePersonality contract onto its personality props, so no surface can forget
 * a handler or let the presentation drift. Per-screen differences (custom
 * trigger, single-provider lock, favorites) ride the passthrough props; the
 * personality behavior differences live entirely in the producer hook.
 */
export function RoleModelSelector({
  personality,
  ...modelProps
}: RoleModelSelectorProps): ReactElement {
  return (
    <CombinedModelSelector
      {...modelProps}
      personalities={personality?.personalities}
      selectedPersonalityId={personality?.selectedPersonalityId ?? null}
      onSelectPersonality={personality?.onSelectPersonality}
      onClearPersonality={personality?.onClearPersonality}
      onSelectModelOverPersonality={personality?.onSelectModelOverPersonality}
    />
  );
}
