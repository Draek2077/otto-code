import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { z } from "zod";

export const knowledgeKinds = {
  decision: "decisions",
  constraint: "constraints",
  requirement: "requirements",
  architecture: "architectures",
  finding: "findings",
  project: "projects",
  reference: "references",
} as const;

export type KnowledgeKind = keyof typeof knowledgeKinds;

const metadataSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum([
      "decision",
      "constraint",
      "requirement",
      "architecture",
      "finding",
      "project",
      "reference",
    ]),
    title: z.string().min(1),
    status: z.enum(["proposed", "confirmed", "superseded"]),
    tags: z.array(z.string()),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .passthrough();

const timelineSchema = z.array(
  z
    .object({
      time: z.string().datetime(),
      kind: z.string().min(1),
      summary: z.string(),
    })
    .passthrough(),
);

export interface KnowledgePage {
  metadata: z.infer<typeof metadataSchema>;
  statement: string;
  /** Original timeline with normalized line endings, including unknown fields/event kinds. */
  timeline: string;
  revision: string;
}

export function digest(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function parseKnowledgePage(raw: string): KnowledgePage {
  const parts = splitPage(raw);
  const document = parseDocument(parts.frontmatter, { uniqueKeys: true });
  if (document.errors.length) throw new Error("Invalid Knowledge frontmatter");
  const metadata = metadataSchema.parse(document.toJS());
  const timeline = parseDocument(parts.timeline, { uniqueKeys: true });
  if (timeline.errors.length) throw new Error("Invalid Knowledge timeline");
  if (parts.timeline.trim()) {
    timelineSchema.parse(timeline.toJS());
  }
  return { metadata, statement: parts.statement, timeline: parts.timeline, revision: digest(raw) };
}

interface PageParts {
  frontmatter: string;
  heading: string;
  statement: string;
  timeline: string;
}

const timelineHeading = "## Timeline";
const timelinePrefixLength = `${timelineHeading}\n\n`.length;

function splitPage(raw: string): PageParts {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(
    /^---\n([\s\S]*?)\n---\n\n?(# [^\n]+)\n\n<!-- compiled_truth -->\n\n/,
  );
  if (!match) throw new Error("Unsupported Knowledge Markdown; explicit migration required");
  const content = normalized.slice(match[0].length);
  const candidates = timelineBoundaries(content);
  if (!candidates.length) throw new Error("Knowledge timeline boundary is missing");
  const valid = candidates.filter((offset) =>
    validTimeline(content.slice(offset + timelinePrefixLength)),
  );
  if (valid.length !== 1) throw new Error("Invalid or ambiguous Knowledge timeline boundaries");
  const offset = valid[0];
  return {
    frontmatter: match[1],
    heading: match[2],
    statement: content.slice(0, offset - 2),
    timeline: content.slice(offset + timelinePrefixLength),
  };
}

interface MarkdownFence {
  marker: string;
  width: number;
}

function timelineBoundaries(content: string): number[] {
  const lines = content.split("\n");
  const boundaries: number[] = [];
  let fence: MarkdownFence | undefined;
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        delimiter &&
        delimiter[1][0] === fence.marker &&
        delimiter[1].length >= fence.width &&
        !delimiter[2].trim()
      )
        fence = undefined;
    } else if (delimiter && (delimiter[1][0] !== "`" || !delimiter[2].includes("`"))) {
      fence = { marker: delimiter[1][0], width: delimiter[1].length };
    } else if (line === timelineHeading && lines[index - 1] === "" && lines[index + 1] === "") {
      boundaries.push(offset);
    }
    offset += line.length + 1;
  }
  return boundaries;
}

function validTimeline(raw: string): boolean {
  try {
    const document = parseDocument(raw, { uniqueKeys: true });
    return (
      !document.errors.length && (!raw.trim() || timelineSchema.safeParse(document.toJS()).success)
    );
  } catch {
    return false;
  }
}

export interface KnowledgeEvent {
  kind: "decision" | "evidence";
  text: string;
  recordedAt: string;
  source?: string;
}

export function appendPageEvent(input: {
  raw: string;
  event: KnowledgeEvent;
  statement?: string;
}): string {
  const page = parseKnowledgePage(input.raw);
  const parts = splitPage(input.raw);
  const document = parseDocument(parts.frontmatter);
  document.set("updated_at", input.event.recordedAt);
  const changed = input.statement !== undefined && input.statement !== page.statement;
  if (changed && page.metadata.status === "confirmed") document.set("status", "proposed");
  const previousTimeline = parts.timeline.endsWith("\n") ? parts.timeline : `${parts.timeline}\n`;
  return `---\n${document.toString()}---\n${parts.heading}\n\n<!-- compiled_truth -->\n\n${input.statement ?? parts.statement}\n\n## Timeline\n\n${previousTimeline}${renderEvent(input.event)}\n`;
}

export function createDraftPage(input: {
  id: string;
  kind: KnowledgeKind;
  title: string;
  statement: string;
  tags: string[];
  now: string;
}): string {
  const metadata = {
    id: input.id,
    kind: input.kind,
    title: input.title,
    status: "proposed",
    tags: input.tags,
    created_at: input.now,
    updated_at: input.now,
  };
  const frontmatter = Object.entries(metadata)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  return `---\n${frontmatter}\n---\n# ${input.title}\n\n<!-- compiled_truth -->\n\n${input.statement}\n\n## Timeline\n\n${renderEvent({ kind: "decision", text: "Knowledge draft created.", recordedAt: input.now })}\n`;
}

function renderEvent(event: KnowledgeEvent): string {
  const lines = [
    `- time: ${JSON.stringify(event.recordedAt)}`,
    `  kind: ${JSON.stringify(event.kind)}`,
    `  summary: ${JSON.stringify(event.text)}`,
  ];
  if (event.source) lines.push(`  source: ${JSON.stringify(event.source)}`);
  return lines.join("\n");
}
