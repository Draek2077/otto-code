import { z } from "zod";
import {
  ArtifactId,
  ArtifactLocation,
  ArtifactSelection,
  ArtifactCommand,
} from "@getpaseo/plugin/otto/artifacts";
import type { ArtifactDaemonService } from "./service.js";
import type { PaseoToolDefinition } from "../../agent/tools/types.js";
import type { RetainedToolPolicy } from "../retained-tool-policy.js";
import type { AgentManager } from "../../agent/agent-manager.js";
import type { ArtifactCaller } from "./sources.js";

/** Small composition adapter keeps branching and identity resolution out of Paseo's catalog. */
export function artifactCatalogTools(ports: {
  host?: ArtifactDaemonService;
  policy?: RetainedToolPolicy;
  manager: Pick<AgentManager, "getAgent">;
  callerAgentId?: string | null;
}) {
  const { host, policy, manager, callerAgentId } = ports;
  if (!host || !policy) return [];
  return createArtifactTools({
    host,
    policy,
    caller: () => {
      const agent = callerAgentId ? manager.getAgent(callerAgentId) : null;
      return {
        workspaceId: agent?.workspaceId ?? null,
        agentId: callerAgentId ?? undefined,
        provider: agent?.provider,
        labels: agent?.labels,
      };
    },
  });
}

export function createArtifactTools(ports: {
  host: ArtifactDaemonService;
  policy: RetainedToolPolicy;
  caller(): ArtifactCaller;
}): PaseoToolDefinition[] {
  const reference = z.object({ artifactId: ArtifactId, location: ArtifactLocation });
  const write = reference.extend({ expectedRevision: z.string().regex(/^[a-f0-9]{64}$/) });
  const tool = <S extends z.ZodObject>(
    name: string,
    description: string,
    inputSchema: S,
    run: (input: z.infer<S>, workspaceId: string, caller: ArtifactCaller) => Promise<unknown>,
  ): PaseoToolDefinition => ({
    name,
    description,
    inputSchema: inputSchema.extend({
      workspaceId: z
        .string()
        .min(1)
        .max(512)
        .optional()
        .describe(
          "Defaults to the calling chat's workspace. Required outside a chat; a chat cannot target another workspace.",
        ),
    }),
    async handler(value) {
      try {
        const envelope = inputSchema
          .extend({ workspaceId: z.string().min(1).max(512).optional() })
          .parse(value);
        const requested = z.string().optional().parse(envelope.workspaceId);
        const fields = { ...envelope };
        delete fields.workspaceId;
        const input = inputSchema.parse(fields),
          caller = ports.caller();
        const workspaceId = requested ?? caller.workspaceId;
        if (
          !workspaceId ||
          (caller.workspaceId && caller.workspaceId !== workspaceId) ||
          !(await ports.policy(name, caller.provider))
        )
          throw new Error("Unavailable");
        const result = await run(input, workspaceId, caller);
        if (Buffer.byteLength(JSON.stringify(result)) > 400000)
          throw new Error("Result exceeds the tool budget");
        return { content: [], structuredContent: result };
      } catch {
        return {
          content: [],
          isError: true,
          structuredContent: {
            error:
              "Artifacts could not acknowledge this action. Inspect the owning workspace library before another write. No automatic retry or alternate project was selected.",
          },
        };
      }
    },
  });
  const ref = (input: z.infer<typeof reference>, workspaceId: string) => ({
    scope: ports.host.workspaceScope(workspaceId),
    id: input.artifactId,
    location: input.location,
  });
  return [
    tool(
      "list_artifacts",
      "List a bounded page of this chat workspace's project artifacts before creating one. Metadata only; offset pages contain at most 100 entries. Diagnostics disclose unreadable records; never assume an empty page means no store.",
      z
        .object({
          query: z.string().max(200).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .strict(),
      (input, workspaceId) =>
        ports.host.list({ ...input, scope: ports.host.workspaceScope(workspaceId) }),
    ),
    tool(
      "create_artifact",
      "Create a durable self-contained interactive HTML deliverable for this workspace's project. Returns immediately with generating status; inspect later, do not create duplicates. Optional provider/model selects generation. No external publication. Use update_artifact_data to refresh an existing data contract without redesigning it.",
      z
        .object({
          name: z.string().min(1).max(200),
          description: z.string().min(1).max(12000),
          selection: ArtifactSelection.optional(),
        })
        .strict(),
      async (input, workspaceId, caller) =>
        ports.host.create(
          { ...input, scope: ports.host.workspaceScope(workspaceId) },
          await ports.host.callerSource(caller),
        ),
    ),
    tool(
      "inspect_artifact",
      "Inspect revision, status, recovery, generation log and bounded run history without loading HTML/data into context. Requires the location returned by list_artifacts. Request includeHtml/includeData only when those bytes are needed; prefer get_artifact_data for a data refresh. Host paths are disclosures, not client-local paths. Do not poll rapidly while generating.",
      reference
        .extend({ includeHtml: z.boolean().optional(), includeData: z.boolean().optional() })
        .strict(),
      async (input, workspaceId) => {
        const { html, data, ...inspection } = await ports.host.read(ref(input, workspaceId));
        return {
          ...inspection,
          ...(input.includeHtml ? { html } : {}),
          ...(input.includeData ? { data } : {}),
        };
      },
    ),
    tool(
      "get_artifact_data",
      "Read ONLY the artifact's explicit JSON data contract and revision before a data-only refresh. No presentation HTML is returned. A missing contract requires user-approved regeneration, never a guessed data injection.",
      reference.strict(),
      async (input, workspaceId) => {
        const doc = await ports.host.read(ref(input, workspaceId));
        return { artifact: doc.artifact, data: doc.data };
      },
    ),
    tool(
      "update_artifact_data",
      "Replace ONLY the otto-artifact-data JSON block, preserving every presentation byte outside it. Inspect first and supply expectedRevision. Missing data contracts require explicit regeneration; never use regeneration as a data update fallback.",
      write.extend({ json: z.string().max(100000) }).strict(),
      async (input, workspaceId, caller) =>
        ports.host.change(
          {
            ...ref(input, workspaceId),
            expectedRevision: input.expectedRevision,
            command: { type: "data", json: input.json },
          },
          await ports.host.callerSource(caller),
        ),
    ),
    tool(
      "change_artifact",
      "Explicit revision-pinned metadata, cancel, repair, delete, move or design-changing regeneration. Destructive commands require their advertised literal userApproved fields; obtain user consent first. Cancellation interrupts/closes the owned session and revokes publication; provider shutdown is not a guarantee about billing. Moves stay within the same project and never overwrite a destination.",
      write.extend({ command: ArtifactCommand }).strict(),
      async (input, workspaceId, caller) =>
        ports.host.change(
          {
            ...ref(input, workspaceId),
            expectedRevision: input.expectedRevision,
            command: input.command,
          },
          input.command.type === "regenerate" || input.command.type === "data"
            ? await ports.host.callerSource(caller)
            : undefined,
        ),
    ),
  ];
}
