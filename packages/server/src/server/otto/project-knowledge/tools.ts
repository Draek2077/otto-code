import { z } from "zod";
import {
  KnowledgeCommandSchema,
  KnowledgeRootSchema,
  mutateKnowledge,
  readKnowledgeCatalog,
  readKnowledgePage,
  readKnowledgeRoot,
  readKnowledgeLinkHealth,
  inspectKnowledgeFormat,
  applyKnowledgeFormat,
  type KnowledgeScope,
} from "@getpaseo/plugin/otto/project-knowledge";
import type { PaseoToolDefinition } from "../../agent/tools/types.js";
import type { KnowledgeDaemonService } from "./host.js";

const workspaceId = z
  .string()
  .min(1)
  .optional()
  .describe("Defaults to this chat's workspace. Required outside an agent session.");
/** All providers use this same daemon boundary. No model-request bodies or roots are injected. */
export function createKnowledgeTools(
  host: KnowledgeDaemonService,
  scopeForWorkspace: (requested?: string) => Promise<KnowledgeScope>,
): PaseoToolDefinition[] {
  const tool = <S extends z.ZodType>(
    name: string,
    description: string,
    schema: S,
    run: (input: z.infer<S>) => Promise<unknown>,
  ): PaseoToolDefinition => ({
    name,
    description,
    inputSchema: schema,
    async handler(input) {
      try {
        const result = await run(schema.parse(input));
        return { content: [], structuredContent: result };
      } catch {
        return {
          content: [],
          isError: true,
          structuredContent: {
            ok: false,
            error: {
              code: "unavailable",
              message:
                "Knowledge could not be read or changed in the selected workspace. Existing data has not been discarded; check the owning host and reload before retrying a write.",
            },
          },
        };
      }
    },
  });
  return [
    tool(
      "inspect_project_knowledge_format",
      "Inspect a revision-pinned conversion preview for the known older Markdown and v1 JSON formats on the owning host. This is read-only and returns bounded metadata, never article bodies. No store is initialized and no data is rewritten.",
      z.object({ workspaceId }).strict(),
      async (input) =>
        host.invoke(inspectKnowledgeFormat.name, {
          scope: await scopeForWorkspace(input.workspaceId),
        }),
    ),
    tool(
      "migrate_project_knowledge_format",
      "Apply a previously inspected Knowledge conversion only after explicit human agreement. Requires the exact preview revision and a reason; verifies recovery copies before replacing legacy Markdown, retains original JSON and unknown fields, and never re-slugs identities. A conflict or partial failure requires a new explicit inspection, never automatic retry or rollback.",
      z
        .object({
          workspaceId,
          expectedRevision: z.string().length(64),
          reason: z.string().trim().min(1).max(65536),
          userApprovedMigration: z.boolean(),
        })
        .strict(),
      async (input) => {
        if (!input.userApprovedMigration)
          return {
            ok: false,
            error: {
              code: "invalid",
              message: "Explicit human agreement is required before Knowledge format conversion.",
            },
          };
        return host.invoke(applyKnowledgeFormat.name, {
          scope: await scopeForWorkspace(input.workspaceId),
          expectedRevision: input.expectedRevision,
          reason: input.reason,
        });
      },
    ),
    tool(
      "lint_project_knowledge_links",
      "Check wiki-links in current confirmed truth and project roots against active confirmed pages. Draft/History targets are reported as inactive; historical timeline links are ignored. Returns bounded metadata with originating revisions, never bodies. Read the source before an explicit revision-pinned repair; this tool never rewrites or confirms data.",
      z
        .object({
          workspaceId,
          offset: z.number().int().nonnegative().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .strict(),
      async (input) =>
        host.invoke(readKnowledgeLinkHealth.name, {
          scope: await scopeForWorkspace(input.workspaceId),
          offset: input.offset ?? 0,
          limit: input.limit ?? 50,
        }),
    ),
    tool(
      "list_project_knowledge",
      "Discover confirmed project pages and six roots. Returns bounded metadata, never article bodies. Include inactive pages only for explicit review.",
      z
        .object({
          workspaceId,
          includeInactive: z.boolean().optional(),
          query: z.string().max(256).optional(),
          offset: z.number().int().nonnegative().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .strict(),
      async (input) =>
        host.invoke(readKnowledgeCatalog.name, {
          scope: await scopeForWorkspace(input.workspaceId),
          includeInactive: input.includeInactive ?? false,
          query: input.query ?? "",
          offset: input.offset ?? 0,
          limit: input.limit ?? 50,
        }),
    ),
    tool(
      "read_project_knowledge",
      "Read one rich Markdown record and its append-only history. Fetch bodies only when relevant. Draft/History reads require includeInactive.",
      z
        .object({ workspaceId, id: z.string().min(1), includeInactive: z.boolean().optional() })
        .strict(),
      async (input) => {
        const scope = await scopeForWorkspace(input.workspaceId);
        const project = await host.resolveProject(scope);
        const found = (
          await host.service.catalog(project.projectId, input.includeInactive ?? false)
        ).find((page) => page.id === input.id);
        if (!found)
          return {
            ok: false,
            error: {
              code: "not_found",
              message:
                "No matching visible Knowledge page. Request inactive pages only for explicit review.",
            },
          };
        return host.invoke(readKnowledgePage.name, { scope, id: found.id, kind: found.kind });
      },
    ),
    tool(
      "read_project_knowledge_root",
      "Read one project-map root on demand: background, architecture, flow, mindmap, stack or roadmap.",
      z.object({ workspaceId, slug: KnowledgeRootSchema }).strict(),
      async (input) =>
        host.invoke(readKnowledgeRoot.name, {
          scope: await scopeForWorkspace(input.workspaceId),
          slug: input.slug,
        }),
    ),
    tool(
      "read_project_knowledge_policy",
      "Read optional project-specific Knowledge guidance on its owning host, only when relevant. This never loads a client-local path or injects policy into other requests.",
      z.object({ workspaceId }).strict(),
      async (input) => ({
        ok: true,
        value: await host.policy(await scopeForWorkspace(input.workspaceId)),
      }),
    ),
    tool(
      "manage_project_knowledge",
      "Create Draft records/charters/references, update truth with a reason, append evidence, track delivery, evaluate references or edit roots. Use read revisions; never retry or rebase a conflict automatically. Reconcile only verified durable outcomes at effort end. Never confirm or supersede without explicit user agreement; set userApprovedReview only after that agreement. Initialization is explicit and preserves authored roots. Purge permanently deletes a canonical page and its history and repairs incoming current wiki-links; separate storage/format recovery copies remain unchanged. Purge requires explicit human approval and userApprovedDeletion.",
      z
        .object({
          workspaceId,
          command: KnowledgeCommandSchema,
          userApprovedReview: z.boolean().optional(),
          userApprovedDeletion: z.boolean().optional(),
        })
        .strict(),
      async (input) => {
        if (input.command.action === "purge" && !input.userApprovedDeletion)
          return {
            ok: false,
            error: {
              code: "invalid",
              message: "Explicit human approval is required before permanently deleting Knowledge.",
            },
          };
        if (input.command.action === "review" && !input.userApprovedReview)
          return {
            ok: false,
            error: {
              code: "invalid",
              message:
                "Explicit user agreement is required before changing Knowledge review status.",
            },
          };
        return host.invoke(mutateKnowledge.name, {
          scope: await scopeForWorkspace(input.workspaceId),
          command: input.command,
        });
      },
    ),
  ];
}
