import type { ComponentType } from "react";
import type { PluginTimelineItemProps } from "./contracts.js";
import type { SuggestedTaskCardData } from "../otto/suggested-task.js";

export { suggestedTaskSchema } from "../otto/suggested-task.js";
export declare const SuggestedTaskCard: ComponentType<
  PluginTimelineItemProps<SuggestedTaskCardData>
>;
