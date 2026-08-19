import { z } from "zod";

/**
 * Otto project-link wire schemas: the project.links.* RPCs and their payloads. Fork-only capability, so it owns its schemas; messages.ts re-exports them.
 */

// An unordered pair of linked projects. The daemon stores the pair in a
// canonical order, but clients treat it as undirected: a link between A and B
// permits opening files across both projects. See the gated-multi-root project.
export const ProjectLinkSchema = z.object({
  projectAId: z.string(),
  projectBId: z.string(),
});

export const ProjectLinksListRequestSchema = z.object({
  type: z.literal("project.links.list.request"),
  requestId: z.string(),
});

export const ProjectLinksSetRequestSchema = z.object({
  type: z.literal("project.links.set.request"),
  // Order is irrelevant; the daemon canonicalizes. Linking is idempotent.
  projectId: z.string(),
  otherProjectId: z.string(),
  requestId: z.string(),
});

export const ProjectLinksUnsetRequestSchema = z.object({
  type: z.literal("project.links.unset.request"),
  projectId: z.string(),
  otherProjectId: z.string(),
  requestId: z.string(),
});

export const ProjectLinksListResponsePayloadSchema = z.object({
  requestId: z.string(),
  links: z.array(ProjectLinkSchema).default([]),
  error: z.string().nullable(),
});

export const ProjectLinksListResponseSchema = z.object({
  type: z.literal("project.links.list.response"),
  payload: ProjectLinksListResponsePayloadSchema,
});

export const ProjectLinksMutationResponsePayloadSchema = z.object({
  requestId: z.string(),
  accepted: z.boolean(),
  // The full link set after the mutation, so the client refreshes in one hop.
  links: z.array(ProjectLinkSchema).default([]),
  error: z.string().nullable(),
});

export const ProjectLinksSetResponseSchema = z.object({
  type: z.literal("project.links.set.response"),
  payload: ProjectLinksMutationResponsePayloadSchema,
});

export const ProjectLinksUnsetResponseSchema = z.object({
  type: z.literal("project.links.unset.response"),
  payload: ProjectLinksMutationResponsePayloadSchema,
});

// Pushed to the session whenever the link set changes (mutation or cascade on
// project removal) so open UIs re-evaluate cross-project access without polling.
export const ProjectLinksChangedPayloadSchema = z.object({
  links: z.array(ProjectLinkSchema).default([]),
});

export const ProjectLinksChangedSchema = z.object({
  type: z.literal("project.links.changed"),
  payload: ProjectLinksChangedPayloadSchema,
});

export type ProjectLink = z.infer<typeof ProjectLinkSchema>;

export type ProjectLinksListResponse = z.infer<typeof ProjectLinksListResponseSchema>;

export type ProjectLinksListResponsePayload = z.infer<typeof ProjectLinksListResponsePayloadSchema>;

export type ProjectLinksSetResponse = z.infer<typeof ProjectLinksSetResponseSchema>;

export type ProjectLinksUnsetResponse = z.infer<typeof ProjectLinksUnsetResponseSchema>;

export type ProjectLinksMutationResponsePayload = z.infer<
  typeof ProjectLinksMutationResponsePayloadSchema
>;

export type ProjectLinksChanged = z.infer<typeof ProjectLinksChangedSchema>;

export type ProjectLinksListRequest = z.infer<typeof ProjectLinksListRequestSchema>;

export type ProjectLinksSetRequest = z.infer<typeof ProjectLinksSetRequestSchema>;

export type ProjectLinksUnsetRequest = z.infer<typeof ProjectLinksUnsetRequestSchema>;
