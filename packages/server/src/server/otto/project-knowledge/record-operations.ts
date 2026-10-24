import { z } from "zod";
import { appendPageEvent, type KnowledgePage } from "./markdown-page.js";
import { KnowledgeService, type RecordEdit } from "./knowledge-service.js";

export const KnowledgeStatusSchema = z.enum(["proposed", "confirmed", "superseded"]);
export const DeliveryStatusSchema = z.enum([
  "charter",
  "in_build",
  "partial",
  "blocked",
  "complete",
  "reference",
  "deferred",
  "cancelled",
]);
export const ReferenceDispositionSchema = z.enum([
  "unevaluated",
  "read",
  "adopted",
  "rejected",
  "dependency",
]);
export const ProgressSchema = z
  .object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    unit: z.string().trim().min(1).max(48),
  })
  .strict()
  .refine((value) => value.completed <= value.total, "Completed exceeds total");
const reasonSchema = z.string().trim().min(1).max(65536);
const titleSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !/[\r\n]/.test(value));
const sourceSchema = z
  .url()
  .refine((value) => new Set(["https:", "http:"]).has(new URL(value).protocol));

/** These operations update one canonical record with the same digest/lock as truth edits. */
export class KnowledgeRecordOperations {
  constructor(private readonly service: KnowledgeService) {}

  review(input: RecordEdit & { status: z.infer<typeof KnowledgeStatusSchema>; reason: string }) {
    const status = KnowledgeStatusSchema.parse(input.status);
    return this.change(input, { status }, reasonSchema.parse(input.reason), "note");
  }

  describe(input: RecordEdit & { title: string; tags: string[]; reason: string }) {
    return this.change(
      input,
      {
        title: titleSchema.parse(input.title),
        tags: z.array(z.string().trim().min(1).max(128)).max(100).parse(input.tags),
      },
      reasonSchema.parse(input.reason),
      "decision",
    );
  }

  delivery(
    input: RecordEdit & {
      deliveryStatus: z.infer<typeof DeliveryStatusSchema>;
      progress?: z.infer<typeof ProgressSchema> | null;
      reason: string;
    },
  ) {
    if (input.kind !== "project") throw new Error("Delivery belongs to a project charter");
    const metadata: Record<string, string | number | null> = {
      delivery_status: DeliveryStatusSchema.parse(input.deliveryStatus),
    };
    if (input.progress !== undefined) {
      const progress = input.progress === null ? null : ProgressSchema.parse(input.progress);
      metadata.progress_completed = progress?.completed ?? null;
      metadata.progress_total = progress?.total ?? null;
      metadata.progress_unit = progress?.unit ?? null;
    }
    return this.change(input, metadata, reasonSchema.parse(input.reason), "note");
  }

  reference(
    input: RecordEdit & {
      disposition: z.infer<typeof ReferenceDispositionSchema>;
      sourceUrl?: string | null;
      reason: string;
    },
  ) {
    if (input.kind !== "reference") throw new Error("Evaluation belongs to a reference page");
    const metadata: Record<string, string | null> = {
      reference_disposition: ReferenceDispositionSchema.parse(input.disposition),
    };
    if (input.sourceUrl !== undefined)
      metadata.source_url = input.sourceUrl === null ? null : sourceSchema.parse(input.sourceUrl);
    return this.change(input, metadata, reasonSchema.parse(input.reason), "decision");
  }

  private change(
    input: RecordEdit,
    metadata: Readonly<Record<string, string | number | string[] | null>>,
    reason: string,
    kind: "note" | "decision",
  ) {
    return this.service.editPage(input, (raw, now) =>
      appendPageEvent({
        raw,
        metadata,
        event: { kind, text: reason, recordedAt: now },
      }),
    );
  }
}

/** Read metadata without making a copy of historical unknown fields into a client config. */
export function recordDetails(page: KnowledgePage) {
  const metadata = page.metadata;
  const delivery = DeliveryStatusSchema.safeParse(metadata.delivery_status);
  const reference = ReferenceDispositionSchema.safeParse(metadata.reference_disposition);
  const progress = ProgressSchema.safeParse({
    completed: metadata.progress_completed,
    total: metadata.progress_total,
    unit: metadata.progress_unit,
  });
  return {
    deliveryStatus: delivery.success ? delivery.data : null,
    referenceDisposition: reference.success ? reference.data : null,
    sourceUrl: typeof metadata.source_url === "string" ? metadata.source_url : null,
    progress: progress.success
      ? {
          ...progress.data,
          percentage: Math.round((progress.data.completed * 100) / progress.data.total),
        }
      : null,
  };
}
