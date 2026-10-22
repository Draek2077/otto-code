import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const apiBaseUrl = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}, "Use an HTTP(S) endpoint without credentials, query parameters or a fragment.");

export const endpointProfile = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,62}$/)
    .refine((value) => value !== "primary", "Primary is reserved for the original endpoint."),
  label: z.string().trim().min(1).max(120),
  baseUrl: apiBaseUrl,
  model: z.string().default(""),
  apiKeyEnv: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .default("OPENAI_API_KEY"),
  enabled: z.boolean().optional(),
});
export type EndpointSettings = z.infer<typeof endpointProfile>;

export const providerSettings = defineSettings({
  id: "connection",
  scope: "host",
  version: 1,
  schema: z.object({
    baseUrl: z.union([z.literal(""), apiBaseUrl]).default(""),
    model: z.string().default(""),
    apiKeyEnv: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
      .default("OPENAI_API_KEY"),
    maxToolRounds: z.number().int().min(1).max(100).default(24),
    timeoutMs: z.number().int().min(1000).max(1800000).default(300000),
    endpoints: z
      .array(endpointProfile)
      .max(64)
      .superRefine((values, context) => {
        const ids = new Set<string>();
        for (const [index, value] of values.entries()) {
          if (ids.has(value.id))
            context.addIssue({
              code: "custom",
              path: [index, "id"],
              message: "Endpoint IDs must be unique.",
            });
          ids.add(value.id);
        }
      })
      .optional(),
  }),
});
export type ConnectionSettings = z.infer<typeof providerSettings.schema>;
