import { parseEffortLevel, resolveEffortOption } from "@otto-code/protocol/effort";
import type { AgentModelDefinition } from "@otto-code/protocol/agent-types";

/** Otto's cross-provider effort policy after exact advertised option matching. */
export function resolveOttoThinkingFallback({
  requestedThinkingOptionId,
  thinkingOptions,
  defaultThinkingOptionId,
}: {
  requestedThinkingOptionId: string;
  thinkingOptions: NonNullable<AgentModelDefinition["thinkingOptions"]>;
  defaultThinkingOptionId: string | undefined;
}): string {
  if (requestedThinkingOptionId) {
    // A toggle model has no canonical low/medium/high scale. Any remembered
    // non-Off canonical effort means the user wants reasoning enabled.
    const requestedLevel = parseEffortLevel(requestedThinkingOptionId);
    if (
      requestedLevel !== null &&
      requestedLevel !== "off" &&
      thinkingOptions.some((option) => option.id === "on")
    ) {
      return "on";
    }
    try {
      return resolveEffortOption({
        requested: requestedThinkingOptionId,
        thinkingOptions,
      }).optionId;
    } catch {
      // Fully custom option ids can only be restored by exact id; fall through
      // to the model's honest default when a remembered value is unavailable.
    }
  }
  // `ultracode` is an opt-in Claude workflow, not a normal effort level. A
  // provider snapshot may advertise it as its default, but letting that become
  // a fresh form's implicit value launches a different workflow without any
  // user choice. Exact explicit selections returned above remain valid.
  const advertisedDefault = defaultThinkingOptionId;
  if (advertisedDefault && advertisedDefault.toLowerCase() !== "ultracode") {
    return advertisedDefault;
  }
  return thinkingOptions.find((option) => option.id.toLowerCase() !== "ultracode")?.id ?? "";
}
