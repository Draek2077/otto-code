import { z } from "zod";

/**
 * Otto meeting-transcription wire schemas. Fork-only capability, so it owns its schemas rather than declaring them in messages.ts.
 */

// Daemon-owned, provider-neutral meeting transcript library. The initial
// recorder is Zoom-specific, but the retained data model deliberately is not.
// Gated by server_info.features.meetingTranscripts.
export const MeetingTranscriptSchema = z.object({
  id: z.string(),
  provider: z.string(),
  title: z.string(),
  content: z.string(),
  occurredAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const MeetingsTranscriptsListRequestSchema = z.object({
  type: z.literal("meetings.transcripts.list.request"),
  requestId: z.string(),
});

export const MeetingsTranscriptsListResponseSchema = z.object({
  type: z.literal("meetings.transcripts.list.response"),
  payload: z.object({ requestId: z.string(), records: z.array(MeetingTranscriptSchema) }),
});

export const MeetingsTranscriptsCreateRequestSchema = z.object({
  type: z.literal("meetings.transcripts.create.request"),
  requestId: z.string(),
  provider: z.string().min(1).max(48),
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(5_000_000),
  occurredAt: z.string().optional(),
});

export const MeetingsTranscriptsCreateResponseSchema = z.object({
  type: z.literal("meetings.transcripts.create.response"),
  payload: z.object({ requestId: z.string(), record: MeetingTranscriptSchema }),
});

export const MeetingsTranscriptsUpdateRequestSchema = z.object({
  type: z.literal("meetings.transcripts.update.request"),
  requestId: z.string(),
  id: z.string(),
  title: z.string().min(1).max(160).optional(),
  content: z.string().min(1).max(5_000_000).optional(),
});

export const MeetingsTranscriptsUpdateResponseSchema = z.object({
  type: z.literal("meetings.transcripts.update.response"),
  payload: z.object({ requestId: z.string(), record: MeetingTranscriptSchema.nullable() }),
});

export const MeetingsTranscriptsDeleteRequestSchema = z.object({
  type: z.literal("meetings.transcripts.delete.request"),
  requestId: z.string(),
  id: z.string(),
});

export const MeetingsTranscriptsDeleteResponseSchema = z.object({
  type: z.literal("meetings.transcripts.delete.response"),
  payload: z.object({ requestId: z.string(), deleted: z.boolean() }),
});

export type MeetingTranscript = z.infer<typeof MeetingTranscriptSchema>;
export type MeetingsTranscriptsListResponse = z.infer<typeof MeetingsTranscriptsListResponseSchema>;
export type MeetingsTranscriptsCreateResponse = z.infer<
  typeof MeetingsTranscriptsCreateResponseSchema
>;
export type MeetingsTranscriptsUpdateResponse = z.infer<
  typeof MeetingsTranscriptsUpdateResponseSchema
>;
export type MeetingsTranscriptsDeleteResponse = z.infer<
  typeof MeetingsTranscriptsDeleteResponseSchema
>;
