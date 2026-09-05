import { z } from "zod";
import type { ModelTier } from "./agent-types.js";

export const ModelTierSchema: z.ZodType<ModelTier> = z.enum(["deep", "standard", "fast"]);

// A user's explicit tier tag for one model of one provider. The daemon stamps
// `model.tier` at ingest, preferring a matching override here over inference
// (see model-tiers.ts). Stored as an array (not a nested record) so a patch
// replaces it wholesale - that's how a tag gets cleared, since deep-merge can't
// delete a record key.
export const ModelTierOverrideSchema = z
  .object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
    tier: ModelTierSchema,
  })
  .passthrough();

export type ModelTierOverride = z.infer<typeof ModelTierOverrideSchema>;

// A host-owned model-picker visibility choice. Stored as an array so a patch
// replaces it wholesale and removing the final hidden-model entry sticks.
export const ModelVisibilityOverrideSchema = z
  .object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
    visible: z.boolean(),
  })
  .passthrough();

export type ModelVisibilityOverride = z.infer<typeof ModelVisibilityOverrideSchema>;

// A remembered provider endpoint: a base URL together with the credential it
// was saved with, so pointing a provider back at a previous endpoint is one
// pick instead of re-typing the key. Entries are scoped by the connection
// env-var pair they belong to (OPENAI_BASE_URL/OPENAI_API_KEY vs
// ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN), which is exactly what the provider
// settings sheet keys its dropdown off - so every openai-compatible provider
// entry on the host shares one pool, and Claude-compatible entries share
// another. Deliberately `z.string()` rather than an enum: a future env-var
// family must not make old entries unparseable.
export const SavedProviderEndpointSchema = z
  .object({
    /** Stable identity, `${baseUrlKey}::${baseUrl}` - dedupes on re-save. */
    id: z.string().min(1),
    baseUrlKey: z.string().min(1),
    apiKeyKey: z.string().min(1),
    baseUrl: z.string().min(1),
    apiKey: z.string().default(""),
    /** User-facing name; the UI falls back to the URL when absent. */
    label: z.string().optional(),
    /** Epoch ms of the last save, used to order the dropdown newest-first. */
    savedAt: z.number().optional(),
  })
  .passthrough();

export type SavedProviderEndpoint = z.infer<typeof SavedProviderEndpointSchema>;
