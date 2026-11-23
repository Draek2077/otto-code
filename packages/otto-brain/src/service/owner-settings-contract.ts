/** Standalone host settings contracts. Credentials occur only in explicit write intents. */
import { z } from "zod/v3";
import {
  BrainConfigSchema,
  RuntimeConfigSchema,
  TlsSchema,
  ProfileDefaultsSchema,
} from "../config/schema.js";

const Text = z.string().max(32768);
const Credential = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep") }).strict(),
  z.object({ action: z.literal("remove") }).strict(),
  z
    .object({
      action: z.literal("replace"),
      value: z
        .string()
        .min(1)
        .max(16384)
        .refine(
          (value) =>
            [...value].every((letter) => letter.charCodeAt(0) > 32 && letter.charCodeAt(0) !== 127),
          "Use a nonblank credential without control characters",
        ),
    })
    .strict(),
]);
export type OwnerCredentialIntent = z.infer<typeof Credential>;
const RuntimePatch = RuntimeConfigSchema.partial()
  .extend({
    path: Text.nullable().optional(),
    selectionId: z.string().min(1).max(256).nullable().optional(),
  })
  .strict();
const DefaultsPatch = ProfileDefaultsSchema.partial().extend({
  parallelSlots: z.number().int().positive().optional(),
  contextCap: z.number().int().positive().optional(),
  reasoningBudget: z.number().int().optional(),
});
const TlsPatch = TlsSchema.partial().extend({
  renewBeforeDays: z.number().int().min(0).optional(),
  checkIntervalMs: z.number().int().positive().optional(),
});
export const OwnerSettingsSaveSchema = z
  .object({
    ownerId: z.string().min(1).max(256),
    expectedRevision: z.string().min(1).max(256),
    patch: BrainConfigSchema.omit({
      version: true,
      enabled: true,
      autoStart: true,
      auth: true,
      hfToken: true,
      runtime: true,
      listen: true,
      defaults: true,
      tls: true,
    })
      .partial()
      .extend({
        runtime: RuntimePatch.optional(),
        listen: z
          .object({
            host: z.string().min(1).max(1024).optional(),
            port: z.number().int().min(1).max(65535).optional(),
          })
          .strict()
          .optional(),
        auth: z
          .object({ mode: z.enum(["none", "token"]).optional() })
          .strict()
          .optional(),
        defaults: DefaultsPatch.optional(),
        tls: TlsPatch.optional(),
      })
      .strict(),
    credentials: z
      .object({ access: Credential.optional(), huggingFace: Credential.optional() })
      .strict()
      .optional(),
  })
  .strict();
export type OwnerSettingsSave = z.infer<typeof OwnerSettingsSaveSchema>;
export const OwnerSettingsGenerateSchema = OwnerSettingsSaveSchema.pick({
  ownerId: true,
  expectedRevision: true,
}).strict();

export class OwnerSettingsError extends Error {
  constructor(
    readonly kind: "validation" | "conflict" | "unavailable" | "unknown",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
