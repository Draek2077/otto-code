import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import type { OttoToolContext } from "./otto-tool-context.js";
import type { RegisterOttoTool } from "./types.js";

type Dependencies = Pick<OttoToolContext, "options" | "agentManager" | "callerAgentId"> & {
  registerTool: RegisterOttoTool;
};

export function registerKnowledgeTools({
  options,
  agentManager,
  callerAgentId,
  registerTool,
}: Dependencies): void {
  // -------------------------------------------------------------------------
  // Every chat receives a compact active-page catalog. Full rich Markdown
  // pages remain pull-on-demand through these provider-neutral tools.
  // -------------------------------------------------------------------------
  if (options.projectKnowledge) {
    const projectKnowledge = options.projectKnowledge;
    const requireProjectCwd = (): string => {
      if (!callerAgentId)
        throw new Error("Project knowledge tools must be called from an agent session");
      const cwd = agentManager.getAgent(callerAgentId)?.config.cwd;
      if (!cwd)
        throw new Error(
          "This agent has no repository working directory to attach project knowledge to.",
        );
      return cwd;
    };

    const recordOutputSchema = z.object({
      id: z.string(),
      kind: z.string(),
      title: z.string(),
      statement: z.string(),
      evidence: z.string().optional(),
      tags: z.array(z.string()),
      status: z.string(),
      delivery_status: z.string().optional(),
      progress: z
        .object({
          completed: z.number(),
          total: z.number(),
          unit: z.string(),
          percentage: z.number(),
        })
        .optional(),
      reference_disposition: z.string().optional(),
      source_url: z.string().optional(),
      updated_at: z.string(),
      path: z.string().optional(),
      timeline: z.array(
        z.object({
          kind: z.string(),
          text: z.string(),
          recorded_at: z.string(),
          source: z.string().optional(),
          affects: z.array(z.string()).optional(),
        }),
      ),
    });
    const toToolRecord = (record: Awaited<ReturnType<typeof projectKnowledge.list>>[number]) => ({
      id: record.id,
      kind: record.kind,
      title: record.title,
      statement: record.statement,
      ...(record.evidence ? { evidence: record.evidence } : {}),
      tags: record.tags,
      status: record.status,
      ...(record.deliveryStatus ? { delivery_status: record.deliveryStatus } : {}),
      ...(record.progress
        ? {
            progress: {
              ...record.progress,
              percentage: Math.round((record.progress.completed / record.progress.total) * 100),
            },
          }
        : {}),
      ...(record.referenceDisposition
        ? { reference_disposition: record.referenceDisposition }
        : {}),
      ...(record.sourceUrl ? { source_url: record.sourceUrl } : {}),
      updated_at: record.updatedAt,
      ...(record.path ? { path: record.path } : {}),
      timeline: (record.provenance ?? []).map((entry) => {
        const output: {
          kind: string;
          text: string;
          recorded_at: string;
          source?: string;
          affects?: string[];
        } = {
          kind: entry.kind,
          text: entry.text,
          recorded_at: entry.recordedAt,
        };
        if (entry.source) output.source = entry.source;
        if (entry.affects?.length) output.affects = entry.affects;
        return output;
      }),
    });

    registerTool(
      "list_project_knowledge",
      {
        title: "List project knowledge",
        description:
          "List the repository's active project-knowledge pages and six root pages. Call this at task start when the injected catalog indicates relevant knowledge. Inactive pages are omitted unless explicitly requested for review.",
        inputSchema: {
          includeInactive: z
            .boolean()
            .optional()
            .describe("Include proposed and superseded pages for an explicit knowledge review."),
        },
        outputSchema: {
          records: z.array(recordOutputSchema),
          roots: z.array(z.object({ slug: z.string(), title: z.string(), path: z.string() })),
        },
      },
      async ({ includeInactive }) => {
        const view = await projectKnowledge.view(requireProjectCwd());
        return {
          content: [],
          structuredContent: ensureValidJson({
            records: view.records
              .filter((record) => includeInactive || record.status === "confirmed")
              .map(toToolRecord),
            roots: view.rootPages.map(({ slug, title, path }) => ({ slug, title, path })),
          }),
        };
      },
    );

    registerTool(
      "read_project_knowledge",
      {
        title: "Read project knowledge",
        description:
          "Read one active rich Markdown knowledge page, including its complete append-only timeline. Draft and superseded pages require includeInactive for explicit review work.",
        inputSchema: { id: z.string(), includeInactive: z.boolean().optional() },
        outputSchema: { record: recordOutputSchema.nullable() },
      },
      async ({ id, includeInactive }) => {
        const record = await projectKnowledge.get(
          requireProjectCwd(),
          id,
          includeInactive ? { includeInactive: true } : {},
        );
        return {
          content: [],
          structuredContent: ensureValidJson({ record: record ? toToolRecord(record) : null }),
        };
      },
    );

    registerTool(
      "read_project_knowledge_root",
      {
        title: "Read project knowledge root",
        description:
          "Read one rich Markdown project-map root: background, architecture, flow, mindmap, stack, or roadmap.",
        inputSchema: {
          slug: z.enum(["background", "architecture", "flow", "mindmap", "stack", "roadmap"]),
        },
        outputSchema: {
          page: z
            .object({ slug: z.string(), title: z.string(), path: z.string(), body: z.string() })
            .nullable(),
        },
      },
      async ({ slug }) => {
        const page = await projectKnowledge.getRoot(requireProjectCwd(), slug);
        return { content: [], structuredContent: ensureValidJson({ page }) };
      },
    );

    registerTool(
      "update_project_knowledge_root",
      {
        title: "Update project knowledge root",
        description:
          "Replace one project-map root with evidence-backed rich Markdown. Preserve useful detail and wiki-link atomic pages; never populate it from guesses.",
        inputSchema: {
          slug: z.enum(["background", "architecture", "flow", "mindmap", "stack", "roadmap"]),
          body: z.string(),
        },
        outputSchema: { applied: z.boolean(), path: z.string().optional() },
      },
      async ({ slug, body }) => {
        const page = await projectKnowledge.updateRoot({ cwd: requireProjectCwd(), slug, body });
        return {
          content: [],
          structuredContent: ensureValidJson({
            applied: page !== null,
            ...(page ? { path: page.path } : {}),
          }),
        };
      },
    );

    registerTool(
      "lint_project_knowledge_links",
      {
        title: "Lint project knowledge links",
        description:
          "Find unresolved [[wiki links]] in root pages and active compiled truth. Historical timeline text is intentionally not rewritten or linted.",
        inputSchema: {},
        outputSchema: {
          broken: z.array(z.object({ source: z.string(), target: z.string() })),
        },
      },
      async () => ({
        content: [],
        structuredContent: ensureValidJson({
          broken: await projectKnowledge.lintLinks(requireProjectCwd()),
        }),
      }),
    );

    registerTool(
      "query_project_knowledge",
      {
        title: "Query project knowledge",
        description:
          "Search the repository's durable Markdown knowledge. Use this before broad repository searches when the " +
          "task asks why something is done a certain way or what the team already decided. Results include current " +
          "truth and append-only evidence; verify implementation facts against current code when needed.",
        inputSchema: {
          query: z.string().describe("The task or question to match against project knowledge."),
        },
        outputSchema: {
          records: z.array(recordOutputSchema),
        },
      },
      async ({ query }) => {
        const records = await projectKnowledge.query(requireProjectCwd(), query);
        return {
          content: [],
          structuredContent: ensureValidJson({
            records: records.map(toToolRecord),
          }),
        };
      },
    );

    registerTool(
      "record_project_knowledge",
      {
        title: "Record project knowledge",
        description:
          "Record a durable project fact in the repository's shared knowledge store. Default to a proposal. Set " +
          "confirmed only when the user explicitly made or confirmed the record. Findings capture unresolved observations and do not imply a decision or remediation plan. " +
          "Do not record guesses, transient implementation details, secrets, or information that source code states plainly. " +
          "The catalog is injected automatically, while the rich page remains pull-on-demand. Use update_project_knowledge_truth for any later change to current truth, " +
          "because it atomically records the reason in the page timeline.",
        inputSchema: {
          kind: z.enum(["finding", "decision", "constraint", "requirement", "architecture"]),
          id: z
            .string()
            .optional()
            .describe(
              "Optional lowercase kebab-case page id. Otherwise Otto derives it from title.",
            ),
          title: z.string(),
          statement: z.string(),
          evidence: z.string().optional(),
          tags: z.array(z.string()).optional(),
          affects: z
            .array(z.string())
            .optional()
            .describe("Human page ids materially affected by this decision."),
          status: z
            .enum(["proposed", "confirmed"])
            .optional()
            .describe("Defaults to proposed. Use confirmed only after explicit user confirmation."),
        },
        outputSchema: { id: z.string(), status: z.string() },
      },
      async ({ kind, id, title, statement, evidence, tags, affects, status }) => {
        const record = await projectKnowledge.record({
          cwd: requireProjectCwd(),
          kind,
          ...(id ? { id } : {}),
          title,
          statement,
          ...(evidence ? { evidence } : {}),
          ...(tags ? { tags } : {}),
          ...(affects ? { affects } : {}),
          ...(status ? { status } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson({ id: record.id, status: record.status }),
        };
      },
    );

    registerTool(
      "migrate_legacy_project_findings",
      {
        title: "Migrate legacy project findings",
        description:
          "Import every dated report under the repository's legacy findings/ tree as a confirmed first-class Knowledge finding. The import preserves the report body and migration provenance, rewrites relative links for the new location, and never deletes the source tree.",
        inputSchema: {},
        outputSchema: {
          imported: z.number().int().nonnegative(),
          skipped: z.number().int().nonnegative(),
        },
      },
      async () => {
        const result = await projectKnowledge.importLegacyFindings(requireProjectCwd());
        return { content: [], structuredContent: ensureValidJson(result) };
      },
    );

    registerTool(
      "record_project_charter",
      {
        title: "Record project charter",
        description:
          "Create a first-class project charter in repository knowledge. The charter's review status says whether its description is trusted; delivery_status independently tracks execution. Use this for durable initiatives, not transient tasks. Default review status is proposed unless the user explicitly confirms the charter.",
        inputSchema: {
          id: z.string().optional(),
          title: z.string(),
          charter: z
            .string()
            .describe("Rich Markdown scope, outcomes, constraints, and acceptance criteria."),
          deliveryStatus: z
            .enum([
              "charter",
              "in_build",
              "partial",
              "blocked",
              "complete",
              "reference",
              "deferred",
              "cancelled",
            ])
            .optional(),
          progress: z
            .object({
              completed: z.number().int().nonnegative(),
              total: z.number().int().positive(),
              unit: z.string(),
            })
            .optional(),
          evidence: z.string().optional(),
          tags: z.array(z.string()).optional(),
          affects: z.array(z.string()).optional(),
          status: z.enum(["proposed", "confirmed"]).optional(),
        },
        outputSchema: { id: z.string(), status: z.string(), delivery_status: z.string() },
      },
      async ({ id, title, charter, deliveryStatus, progress, evidence, tags, affects, status }) => {
        const record = await projectKnowledge.record({
          cwd: requireProjectCwd(),
          kind: "project",
          ...(id ? { id } : {}),
          title,
          statement: charter,
          ...(deliveryStatus ? { deliveryStatus } : {}),
          ...(progress ? { progress } : {}),
          ...(evidence ? { evidence } : {}),
          ...(tags ? { tags } : {}),
          ...(affects ? { affects } : {}),
          ...(status ? { status } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            id: record.id,
            status: record.status,
            delivery_status: record.deliveryStatus ?? "charter",
          }),
        };
      },
    );

    registerTool(
      "update_project_delivery",
      {
        title: "Update project delivery",
        description:
          "Update a charter's delivery state or structured progress and append the reason permanently. This never confirms or supersedes the charter itself; use set_project_knowledge_status for review state.",
        inputSchema: {
          id: z.string(),
          deliveryStatus: z
            .enum([
              "charter",
              "in_build",
              "partial",
              "blocked",
              "complete",
              "reference",
              "deferred",
              "cancelled",
            ])
            .optional(),
          progress: z
            .object({
              completed: z.number().int().nonnegative(),
              total: z.number().int().positive(),
              unit: z.string(),
            })
            .nullable()
            .optional()
            .describe("Structured completion. Pass null to remove an obsolete metric."),
          reason: z.string(),
          expectedUpdatedAt: z.string().optional(),
        },
        outputSchema: { applied: z.boolean(), error: z.string().optional() },
      },
      async ({ id, deliveryStatus, progress, reason, expectedUpdatedAt }) => {
        const result = await projectKnowledge.updateProject({
          cwd: requireProjectCwd(),
          id,
          ...(deliveryStatus ? { deliveryStatus } : {}),
          ...(progress !== undefined ? { progress } : {}),
          reason,
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            applied: result.record !== null && !result.error,
            ...(result.error ? { error: result.error } : {}),
          }),
        };
      },
    );

    registerTool(
      "record_project_reference",
      {
        title: "Record project reference",
        description:
          "Create a first-class reference page describing an external source and exactly how it affected the project. Record rejected sources too, with the reason, so future agents do not repeat the research.",
        inputSchema: {
          id: z.string().optional(),
          title: z.string(),
          summary: z.string().describe("Rich Markdown evaluation and project relevance."),
          disposition: z
            .enum(["unevaluated", "read", "adopted", "rejected", "dependency"])
            .optional(),
          sourceUrl: z.string().optional(),
          evidence: z.string().optional(),
          tags: z.array(z.string()).optional(),
          affects: z.array(z.string()).optional(),
          status: z.enum(["proposed", "confirmed"]).optional(),
        },
        outputSchema: { id: z.string(), status: z.string(), disposition: z.string() },
      },
      async ({ id, title, summary, disposition, sourceUrl, evidence, tags, affects, status }) => {
        const record = await projectKnowledge.record({
          cwd: requireProjectCwd(),
          kind: "reference",
          ...(id ? { id } : {}),
          title,
          statement: summary,
          ...(disposition ? { referenceDisposition: disposition } : {}),
          ...(sourceUrl ? { sourceUrl } : {}),
          ...(evidence ? { evidence } : {}),
          ...(tags ? { tags } : {}),
          ...(affects ? { affects } : {}),
          ...(status ? { status } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            id: record.id,
            status: record.status,
            disposition: record.referenceDisposition ?? "unevaluated",
          }),
        };
      },
    );

    registerTool(
      "update_project_reference",
      {
        title: "Update project reference",
        description:
          "Update a reference's evaluation or source URL and append the reason permanently. Use update_project_knowledge_truth when its written evaluation also changes.",
        inputSchema: {
          id: z.string(),
          disposition: z
            .enum(["unevaluated", "read", "adopted", "rejected", "dependency"])
            .optional(),
          sourceUrl: z.string().nullable().optional(),
          reason: z.string(),
          expectedUpdatedAt: z.string().optional(),
        },
        outputSchema: { applied: z.boolean(), error: z.string().optional() },
      },
      async ({ id, disposition, sourceUrl, reason, expectedUpdatedAt }) => {
        const result = await projectKnowledge.updateReference({
          cwd: requireProjectCwd(),
          id,
          ...(disposition ? { disposition } : {}),
          ...(sourceUrl !== undefined ? { sourceUrl } : {}),
          reason,
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            applied: result.record !== null && !result.error,
            ...(result.error ? { error: result.error } : {}),
          }),
        };
      },
    );

    registerTool(
      "set_project_knowledge_status",
      {
        title: "Set project knowledge status",
        description:
          "Confirm, supersede, or return a project-knowledge record to proposed. Only confirm or supersede after the user has explicitly agreed. " +
          "A superseded record remains as repository history but is neither injected nor returned by normal search.",
        inputSchema: {
          id: z.string(),
          status: z.enum(["proposed", "confirmed", "superseded"]),
          reason: z.string().optional().describe("Why this review status is appropriate."),
        },
        outputSchema: { applied: z.boolean(), status: z.string() },
      },
      async ({ id, status, reason }) => {
        const record = await projectKnowledge.setStatus(requireProjectCwd(), id, status, reason);
        return {
          content: [],
          structuredContent: ensureValidJson({
            applied: record !== null,
            status: record?.status ?? "not_found",
          }),
        };
      },
    );

    registerTool(
      "delete_project_knowledge",
      {
        title: "Delete accidental project knowledge",
        description:
          "Permanently delete an accidental or junk project-knowledge page. Use only after the user explicitly approves deleting that exact page; supersede valid historical knowledge instead.",
        inputSchema: {
          id: z.string(),
          reason: z
            .string()
            .describe("Why permanent deletion is appropriate instead of superseding."),
          expectedUpdatedAt: z.string().optional(),
        },
        outputSchema: { deleted: z.boolean(), error: z.string().optional() },
      },
      async ({ id, reason, expectedUpdatedAt }) => {
        const result = await projectKnowledge.delete({
          cwd: requireProjectCwd(),
          id,
          reason,
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson(result),
        };
      },
    );

    registerTool(
      "update_project_knowledge_truth",
      {
        title: "Update project knowledge truth",
        description:
          "Rewrite one knowledge page's current truth and atomically append the reason to its permanent timeline. " +
          "Use only after the user explicitly agrees that the established understanding changed.",
        inputSchema: {
          id: z.string(),
          statement: z.string(),
          reason: z.string().describe("Why the current truth changed."),
          source: z.string().optional(),
          affects: z.array(z.string()).optional(),
          expectedUpdatedAt: z.string().optional(),
        },
        outputSchema: { applied: z.boolean(), error: z.string().optional() },
      },
      async ({ id, statement, reason, source, affects, expectedUpdatedAt }) => {
        const result = await projectKnowledge.updateTruth({
          cwd: requireProjectCwd(),
          id,
          statement,
          reason,
          ...(source ? { source } : {}),
          ...(affects ? { affects } : {}),
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            applied: result.record !== null && !result.error,
            ...(result.error ? { error: result.error } : {}),
          }),
        };
      },
    );

    registerTool(
      "append_project_knowledge_evidence",
      {
        title: "Append project knowledge evidence",
        description:
          "Append evidence to a knowledge page's permanent timeline without changing current truth. Use it for " +
          "verified benchmarks, user decisions, or source references that may matter later.",
        inputSchema: {
          id: z.string(),
          text: z.string(),
          source: z.string().optional(),
          affects: z.array(z.string()).optional(),
          expectedUpdatedAt: z.string().optional(),
        },
        outputSchema: { applied: z.boolean(), error: z.string().optional() },
      },
      async ({ id, text, source, affects, expectedUpdatedAt }) => {
        const result = await projectKnowledge.appendEvidence({
          cwd: requireProjectCwd(),
          id,
          text,
          ...(source ? { source } : {}),
          ...(affects ? { affects } : {}),
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
        return {
          content: [],
          structuredContent: ensureValidJson({
            applied: result.record !== null && !result.error,
            ...(result.error ? { error: result.error } : {}),
          }),
        };
      },
    );

    registerTool(
      "bootstrap_project_knowledge",
      {
        title: "Bootstrap project knowledge",
        description:
          "Initialize the repository's Markdown knowledge tree and generated index without requiring `.otto/KNOWLEDGE.md`; preserve optional project guidance when present. " +
          "Then inspect code, official docs, and Git history before creating draft pages. Never invent facts.",
        inputSchema: {},
        outputSchema: { initialized: z.boolean() },
      },
      async () => {
        await projectKnowledge.bootstrap(requireProjectCwd());
        return { content: [], structuredContent: ensureValidJson({ initialized: true }) };
      },
    );
  }
}
