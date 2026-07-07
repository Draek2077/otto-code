import { z } from "zod";
import { ArtifactMetadataSchema } from "./types.js";
import type { CreateArtifactInput } from "./types.js";

// ============================================================================
// Client → Daemon (Requests)
// ============================================================================

export const ArtifactListRequestSchema = z.object({
  type: z.literal("artifact.list.request"),
  projectId: z.string().optional(),
  requestId: z.string(),
});

export const ArtifactCreateRequestSchema = z.object({
  type: z.literal("artifact.create.request"),
  name: z.string(),
  description: z.string(),
  projectId: z.string(),
  provider: z.string(),
  model: z.string().optional(),
  modeId: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  systemPrompt: z.string().optional(),
  requestId: z.string(),
});

export const ArtifactDeleteRequestSchema = z.object({
  type: z.literal("artifact.delete.request"),
  artifactId: z.string(),
  requestId: z.string(),
});

export const ArtifactStarRequestSchema = z.object({
  type: z.literal("artifact.star.request"),
  artifactId: z.string(),
  starred: z.boolean(),
  requestId: z.string(),
});

export const ArtifactGetContentRequestSchema = z.object({
  type: z.literal("artifact.get-content.request"),
  artifactId: z.string(),
  requestId: z.string(),
});

// ============================================================================
// Daemon → Client (Responses)
// ============================================================================

export const ArtifactListResponseSchema = z.object({
  type: z.literal("artifact.list.response"),
  payload: z.object({
    artifacts: z.array(ArtifactMetadataSchema),
    success: z.boolean(),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

export const ArtifactCreateResponseSchema = z.object({
  type: z.literal("artifact.create.response"),
  payload: z.object({
    artifact: ArtifactMetadataSchema,
    success: z.boolean(),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

export const ArtifactDeleteResponseSchema = z.object({
  type: z.literal("artifact.delete.response"),
  payload: z.object({
    success: z.boolean(),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

export const ArtifactStarResponseSchema = z.object({
  type: z.literal("artifact.star.response"),
  payload: z.object({
    artifact: ArtifactMetadataSchema,
    success: z.boolean(),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

export const ArtifactGetContentResponseSchema = z.object({
  type: z.literal("artifact.get-content.response"),
  payload: z.object({
    content: z.string(),
    success: z.boolean(),
    error: z.string().optional(),
    requestId: z.string(),
  }),
});

// ============================================================================
// Daemon → Client (Push Notifications)
// ============================================================================

export const ArtifactCreatedNotificationSchema = z.object({
  type: z.literal("artifact.created.notification"),
  payload: z.object({
    artifact: ArtifactMetadataSchema,
  }),
});

export const ArtifactUpdatedNotificationSchema = z.object({
  type: z.literal("artifact.updated.notification"),
  payload: z.object({
    artifact: ArtifactMetadataSchema,
  }),
});

export const ArtifactDeletedNotificationSchema = z.object({
  type: z.literal("artifact.deleted.notification"),
  payload: z.object({
    artifactId: z.string(),
  }),
});

// ============================================================================
// Type exports
// ============================================================================

export type ArtifactListRequest = z.infer<typeof ArtifactListRequestSchema>;
export type ArtifactCreateRequest = z.infer<typeof ArtifactCreateRequestSchema>;
export type ArtifactDeleteRequest = z.infer<typeof ArtifactDeleteRequestSchema>;
export type ArtifactStarRequest = z.infer<typeof ArtifactStarRequestSchema>;
export type ArtifactGetContentRequest = z.infer<typeof ArtifactGetContentRequestSchema>;

export type ArtifactListResponse = z.infer<typeof ArtifactListResponseSchema>;
export type ArtifactCreateResponse = z.infer<typeof ArtifactCreateResponseSchema>;
export type ArtifactDeleteResponse = z.infer<typeof ArtifactDeleteResponseSchema>;
export type ArtifactStarResponse = z.infer<typeof ArtifactStarResponseSchema>;
export type ArtifactGetContentResponse = z.infer<typeof ArtifactGetContentResponseSchema>;

export type ArtifactCreatedNotification = z.infer<typeof ArtifactCreatedNotificationSchema>;
export type ArtifactUpdatedNotification = z.infer<typeof ArtifactUpdatedNotificationSchema>;
export type ArtifactDeletedNotification = z.infer<typeof ArtifactDeletedNotificationSchema>;

export type ArtifactRequest =
  | ArtifactListRequest
  | ArtifactCreateRequest
  | ArtifactDeleteRequest
  | ArtifactStarRequest
  | ArtifactGetContentRequest;

export type ArtifactResponse =
  | ArtifactListResponse
  | ArtifactCreateResponse
  | ArtifactDeleteResponse
  | ArtifactStarResponse
  | ArtifactGetContentResponse;

export type ArtifactNotification =
  | ArtifactCreatedNotification
  | ArtifactUpdatedNotification
  | ArtifactDeletedNotification;

// Input validation helper — extracts CreateArtifactInput from a create request
export function validateArtifactCreateRequest(
  data: unknown,
): { ok: true; input: CreateArtifactInput; requestId: string } | { ok: false; error: string } {
  const result = ArtifactCreateRequestSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  const { type: _type, requestId, ...rest } = result.data;
  return { ok: true, input: rest as CreateArtifactInput, requestId };
}
