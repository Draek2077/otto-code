import { parseDocument, stringify } from "yaml";
import { z } from "zod";
import { KnowledgeSummarySchema } from "@getpaseo/plugin/otto/project-knowledge";
import { digest, knowledgeKinds, parseKnowledgePage, type KnowledgeKind } from "./markdown-page.js";
import { knowledgeHeadingOffsets } from "./markdown-structure.js";
import { assertSafeSegment } from "./store-resolver.js";

const timestamp = z.string().datetime();
const event = z
  .object({ kind: z.string().min(1), text: z.string(), recordedAt: timestamp })
  .passthrough();
const legacyRecord = z
  .object({
    id: z.string().min(1),
    kind: z.enum(Object.keys(knowledgeKinds) as [KnowledgeKind, ...KnowledgeKind[]]),
    title: z.string().min(1),
    statement: z.string(),
    evidence: z.string().optional(),
    tags: z.array(z.string()),
    status: z.enum(["proposed", "confirmed", "superseded"]),
    createdAt: timestamp,
    updatedAt: timestamp,
    provenance: z.array(event).optional(),
    deliveryStatus: z.string().optional(),
    progress: z
      .object({
        completed: z.number().int().nonnegative(),
        total: z.number().int().positive(),
        unit: z.string().min(1),
      })
      .passthrough()
      .optional(),
    referenceDisposition: z.string().optional(),
    sourceUrl: z.string().optional(),
  })
  .passthrough();
export interface LegacyConversion {
  id: string;
  kind: KnowledgeKind;
  title: string;
  render(input: LegacyRendering): string;
}
interface LegacyRendering {
  now: string;
  reason: string;
}
interface LegacyPageInput {
  metadata: Record<string, unknown>;
  statement: string;
  timeline: unknown[];
  source: LegacySource;
  originalFrontmatter?: string;
}
interface PageRendering extends LegacyRendering {
  metadata: Record<string, unknown>;
  statement: string;
  timeline: unknown[];
  frontmatter?: string;
}
export interface LegacySource {
  format: "otto-json-v1" | "otto-markdown-sections";
  revision: string;
  id: string;
}
const sourceSchema = z
  .object({
    format: z.enum(["otto-json-v1", "otto-markdown-sections"]),
    revision: z.string().length(64),
    id: z.string(),
  })
  .strict();
export function migratedSource(raw: string): LegacySource | null {
  const parsed = sourceSchema.safeParse(parseKnowledgePage(raw).metadata.otto_migration_source);
  return parsed.success ? parsed.data : null;
}
function timelineEntry(value: z.infer<typeof event>) {
  const { kind, text, recordedAt, ...unknown } = value;
  return { ...unknown, time: recordedAt, kind, summary: text };
}
function migrationEvent({ now, reason }: LegacyRendering) {
  return {
    time: now,
    kind: "migration",
    summary: `Explicit Knowledge format conversion. ${reason}`,
  };
}
function render({
  metadata,
  statement,
  timeline,
  now,
  reason,
  frontmatter,
}: PageRendering): string {
  const body = `---\n${frontmatter ?? stringify(metadata)}---\n# ${metadata.title}\n\n<!-- compiled_truth -->\n\n${statement}\n\n## Timeline\n\n${stringify([...timeline, migrationEvent({ now, reason })])}`;
  parseKnowledgePage(body);
  return body;
}
function checkedConversion({
  metadata,
  statement,
  timeline,
  source,
  originalFrontmatter,
}: LegacyPageInput): LegacyConversion {
  assertSafeSegment(source.id);
  const template = { ...metadata, otto_migration_source: source };
  // Planning validates the complete result, including unknown YAML values, before any writes.
  let frontmatter: string | undefined;
  if (originalFrontmatter !== undefined) {
    if (Object.hasOwn(metadata, "otto_migration_source"))
      throw new Error("Legacy conversion provenance requires explicit reconciliation");
    const document = parseDocument(originalFrontmatter, { uniqueKeys: true });
    document.set("otto_migration_source", source);
    frontmatter = document.toString();
  }
  const parsed = parseKnowledgePage(
    render({
      metadata: template,
      statement,
      timeline,
      now: "2000-01-01T00:00:00.000Z",
      reason: "Validated conversion plan",
      frontmatter,
    }),
  );
  KnowledgeSummarySchema.parse({
    ...parsed.metadata,
    updatedAt: parsed.metadata.updated_at,
    revision: parsed.revision,
  });
  return {
    id: parsed.metadata.id,
    kind: parsed.metadata.kind,
    title: parsed.metadata.title,
    render: ({ now, reason }) =>
      render({ metadata: template, statement, timeline, now, reason, frontmatter }),
  };
}
/** The actual frozen v1 JSON shape. Unknown fields survive under their original
 * keys plus the complete byte recovery copy; identities are never re-slugged. */
export function convertLegacyJson(raw: string): LegacyConversion[] {
  const file = z
    .object({ version: z.literal(1), records: z.array(legacyRecord).max(10000) })
    .passthrough()
    .parse(JSON.parse(raw));
  const ids = new Set<string>();
  return file.records.map((record) => {
    if (ids.has(record.id)) throw new Error("Duplicate legacy Knowledge identity");
    ids.add(record.id);
    const {
      id,
      kind,
      title,
      statement,
      evidence,
      tags,
      status,
      createdAt,
      updatedAt,
      provenance,
      deliveryStatus,
      referenceDisposition,
      sourceUrl,
      progress,
      ...unknown
    } = record;
    if (progress && progress.completed > progress.total) throw new Error("Invalid legacy progress");
    const metadata = {
      ...unknown,
      otto_legacy_json_fields: unknown,
      id,
      kind,
      title,
      tags,
      status,
      created_at: createdAt,
      updated_at: updatedAt,
      ...(deliveryStatus !== undefined ? { delivery_status: deliveryStatus } : {}),
      ...(referenceDisposition !== undefined
        ? { reference_disposition: referenceDisposition }
        : {}),
      ...(sourceUrl !== undefined ? { source_url: sourceUrl } : {}),
      ...(progress
        ? {
            progress_completed: progress.completed,
            progress_total: progress.total,
            progress_unit: progress.unit,
            otto_legacy_progress: progress,
          }
        : {}),
    };
    const timeline = (provenance ?? []).map(timelineEntry);
    if (evidence && !timeline.some((item) => item.kind === "evidence" && item.summary === evidence))
      timeline.push({ time: updatedAt, kind: "evidence", summary: evidence });
    return checkedConversion({
      metadata,
      statement,
      timeline,
      source: { format: "otto-json-v1", revision: digest(raw), id },
    });
  });
}
function parseLegacyTimeline(raw: string): unknown[] {
  if (!raw.trim()) return [];
  return raw
    .trimEnd()
    .split("\n")
    .map((line) => {
      const match = line.match(/^- (.+?) \[([^\]]+)\] (.*?)(?: \(source: (.*)\))?$/);
      if (!match) throw new Error("Unsupported legacy timeline; original evidence is preserved");
      const parsed = event.parse({
        recordedAt: match[1],
        kind: match[2],
        text: match[3],
        ...(match[4] ? { source: match[4] } : {}),
      });
      return timelineEntry(parsed);
    });
}
/** Only the known Current truth / Evidence / bullet Timeline format is converted.
 * Ambiguous headings and unparsed evidence fail the plan, never disappear. */
export function convertLegacyMarkdown(raw: string): LegacyConversion {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n\n?(# [^\n]+)\n\n## Current truth\n\n/);
  if (!match) throw new Error("Unsupported legacy Knowledge Markdown");
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length) throw new Error("Invalid legacy Knowledge metadata");
  const metadata = z.record(z.string(), z.unknown()).parse(document.toJS());
  const content = normalized.slice(match[0].length);
  const evidence = knowledgeHeadingOffsets({ content, heading: "## Evidence" });
  const timeline = knowledgeHeadingOffsets({ content, heading: "## Timeline" });
  if (evidence.length !== 1 || timeline.length !== 1 || evidence[0] >= timeline[0])
    throw new Error("Ambiguous legacy Knowledge sections");
  const statement = content.slice(0, evidence[0] - 2);
  const evidenceBody = content.slice(evidence[0] + "## Evidence\n\n".length, timeline[0] - 2);
  const events = parseLegacyTimeline(content.slice(timeline[0] + "## Timeline\n\n".length));
  if (evidenceBody && evidenceBody !== "None.")
    events.push({ time: metadata.updated_at, kind: "evidence", summary: evidenceBody });
  const id = z.string().parse(metadata.id);
  return checkedConversion({
    metadata,
    statement,
    timeline: events,
    source: { format: "otto-markdown-sections", revision: digest(raw), id },
    originalFrontmatter: match[1],
  });
}
