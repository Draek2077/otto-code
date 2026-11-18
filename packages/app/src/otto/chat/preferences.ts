import { z } from "zod";

export interface ActionGroupingPreferences {
  groupConsecutiveActions: boolean;
}
// Retain the 0.9 preference and default, including an explicit opt-out.
export const actionGroupingDefaults: ActionGroupingPreferences = { groupConsecutiveActions: true };
export const actionGroupingStoredPreferences = { groupConsecutiveActions: z.boolean().catch(true) };
