import { z } from "zod";

/** Nonsecret credential methods Otto may present through one Connect flow. */
export const IntegrationAuthorizationMethodSchema = z.string().trim().min(1);

/**
 * Lifecycle state safe to project to a frontend. Secrets and callback material
 * deliberately have no schema here, so they cannot leak through this contract.
 */
export const IntegrationConnectionStateSchema = z.enum([
  "disconnected",
  "authorizing",
  "connected",
  "reauth_required",
  "error",
]);

export const IntegrationConnectionMetadataSchema = z.object({
  integrationId: z.string().trim().min(1),
  connectionId: z.string().trim().min(1),
  method: IntegrationAuthorizationMethodSchema,
  state: IntegrationConnectionStateSchema,
  accountLabel: z.string().nullable(),
  grantedScopes: z.array(z.string()),
  updatedAt: z.string().datetime(),
  errorCode: z.string().nullable(),
  /** Nonsecret daemon-owned availability, independent of authorization state. */
  enabled: z.boolean().optional(),
});

/** A host-safe projection of whether secure storage can accept credentials. */
export const CredentialVaultAvailabilitySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    backend: z.string().trim().min(1),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().trim().min(1),
  }),
]);

/**
 * The settings-safe authorization projection. It is deliberately limited to
 * connection metadata and vault readiness: browser callbacks and credentials
 * never cross this boundary.
 */
export const IntegrationAuthorizationOverviewSchema = z.object({
  vault: CredentialVaultAvailabilitySchema,
  connections: z.array(IntegrationConnectionMetadataSchema),
});

/**
 * A nonsecret connection choice rendered by a future Integration settings
 * surface. The method is intentionally a string rather than an enum so new
 * providers can add a legitimate OAuth/device/API-key flow without breaking an
 * older wire parser.
 */
export const IntegrationAuthorizationMethodOptionSchema = z.object({
  integrationId: z.string().trim().min(1),
  method: IntegrationAuthorizationMethodSchema,
  label: z.string().trim().min(1),
  description: z.string().trim().min(1),
  recommended: z.boolean(),
  availability: z.enum(["available", "planned"]),
});

export type IntegrationAuthorizationMethod = z.infer<typeof IntegrationAuthorizationMethodSchema>;
export type IntegrationConnectionState = z.infer<typeof IntegrationConnectionStateSchema>;
export type IntegrationConnectionMetadata = z.infer<typeof IntegrationConnectionMetadataSchema>;
export type CredentialVaultAvailability = z.infer<typeof CredentialVaultAvailabilitySchema>;
export type IntegrationAuthorizationOverview = z.infer<
  typeof IntegrationAuthorizationOverviewSchema
>;
export type IntegrationAuthorizationMethodOption = z.infer<
  typeof IntegrationAuthorizationMethodOptionSchema
>;
