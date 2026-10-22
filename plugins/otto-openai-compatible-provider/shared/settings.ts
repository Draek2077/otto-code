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
  }),
});
export type ConnectionSettings = z.infer<typeof providerSettings.schema>;
