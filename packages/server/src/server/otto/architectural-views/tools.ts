import { z } from "zod";
import * as rpc from "@getpaseo/plugin/otto/architectural-views";
import type { AgentManager } from "../../agent/agent-manager.js";
import type { PaseoToolDefinition } from "../../agent/tools/types.js";
import type { RetainedToolPolicy } from "../retained-tool-policy.js";
import type { ArchitecturalViewsService } from "./service.js";
import { viewModelText, viewSourcePart } from "./model-results.js";
import { ArchitecturalViewError } from "./specification.js";

export function architecturalViewTools(ports: {
  host?: ArchitecturalViewsService;
  policy?: RetainedToolPolicy;
  manager: Pick<AgentManager, "getAgent">;
  callerAgentId?: string | null;
}): PaseoToolDefinition[] {
  const { host, policy } = ports;
  if (!host || !policy || !host.available()) return [];
  const caller = () => (ports.callerAgentId ? ports.manager.getAgent(ports.callerAgentId) : null);
  const tool = <S extends z.ZodObject>(
    name: string,
    description: string,
    schema: S,
    action: (input: z.infer<S>, workspaceId: string) => Promise<unknown>,
    readOnly: boolean,
  ): PaseoToolDefinition => ({
    name,
    description,
    inputSchema: schema,
    annotations: { readOnlyHint: readOnly },
    async handler(value) {
      try {
        const agent = caller();
        if (!agent?.workspaceId || !(await policy(name, agent.provider)))
          throw new ArchitecturalViewError(
            "unavailable",
            "This tool needs a live workspace chat and enabled Knowledge/View tools.",
          );
        if (value && typeof value === "object" && "specification" in value)
          rpc.parseViewSpecification(value.specification);
        const result = await action(schema.parse(value), agent.workspaceId);
        if (Buffer.byteLength(JSON.stringify(result)) > 750000)
          throw new ArchitecturalViewError("invalid", "The View exceeds its tool-response budget.");
        return {
          content: [{ type: "text", text: viewModelText(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          content: [],
          isError: true,
          structuredContent: {
            code: error instanceof ArchitecturalViewError ? error.code : "unknown",
            error:
              error instanceof ArchitecturalViewError
                ? error.message
                : "The View action was not acknowledged. Inspect this workspace's library before another write; never retry or recreate automatically.",
          },
        };
      }
    },
  });
  const boundDraft = async (workspaceId: string) => {
    const agent = caller();
    const context = rpc.viewAuthoringContext(agent?.labels, host.ports.hostId);
    if (!context || context.workspaceId !== workspaceId)
      throw new ArchitecturalViewError(
        "unavailable",
        "This chat is not a bound Architectural View authoring chat.",
      );
    const projectId = await host.project(host.workspaceScope(workspaceId));
    const selected = await host.library.selected(projectId, context.identity, {
      kind: "draft",
      draftId: context.draftId,
    });
    if (selected.kind !== "draft" || selected.record.value.authoringAgentId !== agent?.id)
      throw new ArchitecturalViewError(
        "conflict",
        "This chat's draft binding is no longer active. Read the workspace library.",
      );
    return { context, projectId, selected };
  };
  return [
    tool(
      "list_architectural_views",
      "List metadata for the current chat workspace's project Views and staged drafts. Read before showing an existing View. At most 10 metadata rows per bounded page; follow nextOffset; unreadable records remain explicit diagnostics. No source or HTML is loaded into context.",
      z
        .object({
          reference: rpc.ViewReference.optional(),
          offset: z.number().int().min(0).max(2000).optional(),
        })
        .strict(),
      async (input, workspaceId) => {
        const result = await host.library.catalog(
          await host.project(host.workspaceScope(workspaceId)),
          input.reference,
          input.offset,
          "",
          10,
          10000,
        );
        return {
          ...result,
          diagnostics: result.diagnostics.slice(0, 3),
          diagnosticsOmitted:
            result.diagnosticsOmitted + Math.max(0, result.diagnostics.length - 3),
        };
      },
      true,
    ),
    tool(
      "read_architectural_view",
      "Read one selected published/revision View's source part and source freshness using its exact origin from the library. Never treat an unknown or stale source hash as confirmed current Knowledge. HTML is not returned. Start at offset 0, then follow source.nextOffset with expectedRevision=source.revision until null. Concatenate source.text to recover the exact JSON; never combine revisions.",
      z
        .object({
          identity: rpc.ViewIdentity,
          offset: z.number().int().min(0).max(524288).optional(),
          expectedRevision: rpc.ViewRevision.optional(),
          selection: z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("published") }),
            z.object({ kind: z.literal("revision"), revisionId: rpc.ViewRevision }),
          ]),
        })
        .strict(),
      async (input, workspaceId) =>
        viewSourcePart(
          await host.library.read(
            await host.project(host.workspaceScope(workspaceId)),
            input.identity,
            input.selection,
          ),
          input,
        ),
      true,
    ),
    tool(
      "read_architectural_view_contract",
      "Read the selected diagram kind's bounded JSON schemas and Otto authoring constraints only when authoring or repairing that kind. Do not load every contract. Read section=common separately for shared definitions. Geometry and identity fields must follow the schema; external brand artwork is unavailable.",
      z
        .object({ diagramType: rpc.ViewKind, section: z.enum(["schema", "common"]).optional() })
        .strict(),
      async (input) => {
        const contract = await host.contract(input.diagramType);
        return {
          diagramType: input.diagramType,
          section: input.section ?? "schema",
          schema: input.section === "common" ? contract.commonSchema : contract.schema,
          guidance: contract.guidance,
        };
      },
      true,
    ),
    tool(
      "read_architectural_view_draft",
      "Read only this chat's bound authoring draft metadata and a bounded JSON source part. Start at offset 0, then follow source.nextOffset with expectedRevision=source.revision until null; concatenate source.text before editing. Only update that draft; publication/discard is a human UI action. A missing binding is not permission to create a replacement.",
      z
        .object({
          offset: z.number().int().min(0).max(524288).optional(),
          expectedRevision: rpc.ViewRevision.optional(),
        })
        .strict(),
      async (input, workspaceId) => {
        const bound = await boundDraft(workspaceId);
        return viewSourcePart(
          await host.library.read(bound.projectId, bound.context.identity, {
            kind: "draft",
            draftId: bound.context.draftId,
          }),
          input,
        );
      },
      true,
    ),
    tool(
      "update_architectural_view_draft",
      "Validate and replace only this chat's exact bound draft source, guarded by expectedRevision from its latest read. The real pinned renderer checks geometry and diagram semantics before writing. Repair validation errors in this draft. Conflicts or uncertain acknowledgments require inspection, never automatic retry, base adoption, publication or duplicate draft creation.",
      z
        .object({
          expectedRevision: rpc.ViewRevision,
          specification: rpc.ViewSpecification,
          title: z.string().min(1).max(200).optional(),
        })
        .strict(),
      async (input, workspaceId) => {
        const bound = await boundDraft(workspaceId);
        const result = await host.drafts.update(bound.projectId, {
          ...input,
          identity: bound.context.identity,
          draftId: bound.context.draftId,
        });
        host.notify(bound.projectId);
        return result;
      },
      false,
    ),
    tool(
      "show_architectural_view",
      "Open an existing published View in this same chat workspace using its exact library identity. This changes presentation only; it does not publish a draft or create a chat. Never target another workspace or guess a View identity.",
      z.object({ identity: rpc.ViewIdentity }).strict(),
      (input, workspaceId) =>
        host.show({ ...input, scope: host.workspaceScope(workspaceId), workspaceId }),
      true,
    ),
  ];
}
