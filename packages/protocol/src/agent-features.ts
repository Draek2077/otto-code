import { z } from "zod";

// Per-agent feature controls (toggles and selects) that providers expose on
// agent snapshots; messages.ts re-exports these for existing importers.

export const AgentSelectOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  family: z.string().optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const AgentFeatureToggleSchema = z.object({
  type: z.literal("toggle"),
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  tooltip: z.string().optional(),
  icon: z.string().optional(),
  value: z.boolean(),
  unavailableReason: z.string().optional(),
});

export const AgentFeatureSelectSchema = z.object({
  type: z.literal("select"),
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  tooltip: z.string().optional(),
  icon: z.string().optional(),
  value: z.string().nullable(),
  options: z.array(AgentSelectOptionSchema),
});

export const AgentFeatureSchema = z.discriminatedUnion("type", [
  AgentFeatureToggleSchema,
  AgentFeatureSelectSchema,
]);
