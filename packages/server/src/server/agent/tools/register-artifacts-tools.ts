import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import type { AgentModelDefinition, AgentProvider } from "../agent-sdk-types.js";
import { type ResolvedProfileSnapshot } from "../agent-profiles.js";
import { getScheduleRunSourceFromLabels } from "@otto-code/protocol/agent-labels";
import type { ProjectRegistry, WorkspaceRegistry } from "../../workspace-registry.js";
import type { ArtifactService } from "../../artifact/artifact-service.js";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { StoredArtifactSchema } from "@otto-code/protocol/artifacts/types";
import {
  resolveScheduleProviderAndModel,
  resolveEffortAgainstModels,
  EFFORT_INPUT_DESCRIPTION,
  resolveEffortOrDropInherited,
} from "./otto-tool-shared.js";
import type { OttoToolContext } from "./otto-tool-context.js";
import type { RegisterOttoTool } from "./types.js";

function resolveArtifactProviderModel(params: {
  providerArg?: string;
  modelArg?: string;
  callerProvider?: AgentProvider;
  callerModel?: string;
}): { provider: AgentProvider; model: string | undefined } {
  const hasProviderOverride = Boolean(params.providerArg?.trim());
  if (!hasProviderOverride && !params.callerProvider) {
    throw new Error("provider is required outside an agent-scoped session");
  }
  const resolved = resolveScheduleProviderAndModel({
    provider: params.providerArg,
    defaultProvider: params.callerProvider ?? "",
  });
  // Model precedence: explicit model arg > provider/<model> > the caller's
  // own model, but only when the caller's provider is the one generating.
  const model =
    params.modelArg?.trim() ||
    resolved.model ||
    (!hasProviderOverride ? params.callerModel : undefined) ||
    undefined;
  return { provider: resolved.provider, model };
}

interface InheritedArtifactIdentity {
  personalityName?: string;
  spinner?: { glowA: string; glowB: string };
}

/**
 * The personality identity an MCP-created artifact inherits from its caller -
 * the caller's personality name and spinner colors - so its card shows who
 * generated it and its spinner renders in the personality's colors. Only
 * inherited when the artifact runs on the caller's own brain: an explicit
 * provider override detaches it, mirroring how the model/effort inherit.
 */
function resolveInheritedArtifactIdentity(params: {
  providerOverridden: boolean;
  snapshot: ResolvedProfileSnapshot | undefined;
}): InheritedArtifactIdentity {
  const snapshot = params.providerOverridden ? undefined : params.snapshot;
  if (!snapshot) {
    return {};
  }
  return {
    ...(snapshot.name ? { personalityName: snapshot.name } : {}),
    ...(snapshot.spinner ? { spinner: snapshot.spinner } : {}),
  };
}

/**
 * Thinking options and modes are provider-scoped, so the caller's own effort
 * level and permission mode only carry over when the caller's provider is the
 * one generating. The mode is a request, not a demand: the artifact service
 * only honors unattended modes and otherwise resolves the provider's
 * unattended default, so an attended caller mode can never stall generation
 * on an approval prompt.
 */
function resolveArtifactGenerationSettings(params: {
  provider: AgentProvider;
  thinkingOptionIdArg?: string;
  modeIdArg?: string;
  callerProvider?: AgentProvider;
  callerThinkingOptionId?: string;
  callerModeId?: string;
}): { thinkingOptionId: string | undefined; modeId: string | undefined } {
  const sameProviderAsCaller = params.callerProvider === params.provider;
  return {
    thinkingOptionId:
      params.thinkingOptionIdArg ??
      (sameProviderAsCaller ? params.callerThinkingOptionId : undefined),
    modeId: params.modeIdArg ?? (sameProviderAsCaller ? params.callerModeId : undefined),
  };
}

const ArtifactToolSummarySchema = z.object({
  artifactId: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  thinkingOptionId: z.string().nullable(),
  modeId: z.string().nullable(),
  projectId: z.string(),
  updatedAt: z.string(),
  errorMessage: z.string().nullable(),
});

function toArtifactToolSummary(artifact: ArtifactMetadata) {
  return {
    artifactId: artifact.id,
    name: artifact.name,
    description: artifact.description,
    status: artifact.status,
    provider: artifact.generationProvider,
    model: artifact.generationModel,
    thinkingOptionId: artifact.generationThinkingOptionId ?? null,
    modeId: artifact.generationModeId ?? null,
    projectId: artifact.projectId,
    updatedAt: artifact.updatedAt,
    errorMessage: artifact.errorMessage,
  };
}

async function requireArtifact(
  artifactService: ArtifactService,
  artifactId: string,
): Promise<ArtifactMetadata> {
  const artifact = (await artifactService.list()).find((candidate) => candidate.id === artifactId);
  if (!artifact) {
    throw new Error(`Artifact ${artifactId} not found. Call list_artifacts for ids.`);
  }
  return artifact;
}

interface ArtifactUpdateToolInput {
  artifactId: string;
  name?: string;
  description?: string;
  provider?: string;
  model?: string | null;
  thinkingOptionId?: string | null;
  projectId?: string;
}

/**
 * Work out the provider/model the update leaves the artifact on: the patch
 * values to store (undefined = unchanged, null model = clear) and the
 * effective pair to resolve a requested effort against.
 */
function resolveArtifactUpdateTargets(
  input: ArtifactUpdateToolInput,
  existing: ArtifactMetadata,
): {
  provider: AgentProvider | undefined;
  model: string | null | undefined;
  effortProvider: AgentProvider | null;
  effortModel: string | undefined;
} {
  const providerPatch = input.provider
    ? resolveScheduleProviderAndModel({
        provider: input.provider,
        defaultProvider: input.provider as AgentProvider,
      })
    : undefined;
  // An explicit model arg beats one embedded in provider/<model>.
  const model = input.model !== undefined ? input.model : providerPatch?.model;
  const effortProvider = (providerPatch?.provider ??
    existing.generationProvider) as AgentProvider | null;
  const effortModel = model === null ? undefined : (model ?? existing.generationModel ?? undefined);
  return { provider: providerPatch?.provider, model, effortProvider, effortModel };
}

/**
 * Effort patch for update_artifact: undefined = unchanged, null = clear
 * (the service stores empty string as null), string = resolve strictly.
 */
function resolveArtifactUpdateEffort(params: {
  requested: string | null | undefined;
  models: readonly AgentModelDefinition[];
  model: string | undefined;
}): string | undefined {
  if (params.requested === undefined) {
    return undefined;
  }
  if (params.requested === null) {
    return "";
  }
  return resolveEffortAgainstModels({
    requested: params.requested,
    models: params.models,
    model: params.model,
  });
}

function buildArtifactUpdateServiceInput(
  input: ArtifactUpdateToolInput,
  targets: { provider: AgentProvider | undefined; model: string | null | undefined },
  thinkingPatch: string | undefined,
) {
  return {
    artifactId: input.artifactId,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(targets.provider ? { provider: targets.provider } : {}),
    // The service stores empty string as null (clear back to provider default).
    ...(targets.model !== undefined ? { model: targets.model ?? "" } : {}),
    ...(thinkingPatch !== undefined ? { thinkingOptionId: thinkingPatch } : {}),
  };
}

const MAX_DERIVED_ARTIFACT_NAME_LENGTH = 60;

// Fallback title when the agent passes only a description: first non-empty
// line, stripped of leading markdown markers, truncated at a word boundary.
function deriveArtifactName(description: string): string {
  const firstLine = description.split("\n").find((line) => line.trim().length > 0) ?? "";
  const cleaned = firstLine
    .replace(/^[#>\-*\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return "Untitled artifact";
  }
  if (cleaned.length <= MAX_DERIVED_ARTIFACT_NAME_LENGTH) {
    return cleaned;
  }
  const truncated = cleaned.slice(0, MAX_DERIVED_ARTIFACT_NAME_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  const clipped =
    lastSpace > MAX_DERIVED_ARTIFACT_NAME_LENGTH / 2 ? truncated.slice(0, lastSpace) : truncated;
  return `${clipped.trimEnd()}…`;
}

function sourceForArtifactCaller(caller: { id: string; labels?: Record<string, unknown> } | null) {
  if (!caller) return {};
  const scheduleSource = getScheduleRunSourceFromLabels(caller.labels);
  if (scheduleSource) {
    return { source: { kind: "schedule" as const, ...scheduleSource } };
  }
  return { source: { kind: "chat" as const, agentId: caller.id } };
}

/**
 * Resolve the projectId to stamp on a created artifact. Artifacts store the
 * project's canonical *root path* (matching what the client's create sheet
 * stores and what the app's project pickers/filters key on) - NOT the
 * registry's opaque grouping key (`remote:host/owner/repo` for repos with a
 * git remote), which nothing client-side can display or match against a
 * workspace. The workspace record only carries the grouping key, so map it
 * through the project registry to the project's rootPath; fall back to the
 * workspace's cwd when the project record is missing.
 */
async function resolveArtifactProjectId(params: {
  projectIdArg?: string;
  callerWorkspaceId?: string;
  workspaceRegistry?: Pick<WorkspaceRegistry, "get" | "upsert">;
  projectRegistry?: Pick<ProjectRegistry, "get">;
}): Promise<string> {
  const explicitProjectId = params.projectIdArg?.trim();
  if (explicitProjectId) {
    return explicitProjectId;
  }
  if (params.callerWorkspaceId && params.workspaceRegistry) {
    const record = await params.workspaceRegistry.get(params.callerWorkspaceId);
    if (record) {
      const project = record.projectId ? await params.projectRegistry?.get(record.projectId) : null;
      if (project?.rootPath) {
        return project.rootPath;
      }
      if (record.cwd) {
        return record.cwd;
      }
    }
  }
  throw new Error("projectId is required because it could not be derived from your workspace");
}

type Dependencies = Pick<
  OttoToolContext,
  "options" | "agentManager" | "providerSnapshotManager" | "callerAgentId" | "listProviderModels"
> & { registerTool: RegisterOttoTool };

export function registerArtifactsTools({
  options,
  agentManager,
  providerSnapshotManager,
  callerAgentId,
  listProviderModels,
  registerTool,
}: Dependencies): void {
  registerTool(
    "create_artifact",
    {
      title: "Create artifact",
      description:
        'Create an artifact: a self-contained HTML page (report, dashboard, visualization, mockup) generated by a background agent and shown in the Artifacts screen. Returns immediately as "generating" and flips to "ready"/"error" on its own within minutes - no need to poll. Runs unattended and inherits your provider/model/effort/mode unless overridden. The generator can\'t see this conversation, so put all content, data, and requirements in the description.',
      inputSchema: {
        name: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "User-visible artifact title. Omit to derive one from the description's first line.",
          ),
        description: z
          .string()
          .trim()
          .min(1, "description is required")
          .describe(
            "Generation prompt. Self-contained: include all content, data, and requirements - the generator has no access to this conversation.",
          ),
        provider: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Provider to generate with, as <provider> or <provider>/<model> (for example codex/gpt-5.4). Defaults to your own provider and model; call list_providers or list_models if uncertain.",
          ),
        model: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Model id for the generation agent. Takes precedence over a model embedded in provider.",
          ),
        thinkingOptionId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            `${EFFORT_INPUT_DESCRIPTION} Defaults to your own effort option when generating with your provider.`,
          ),
        modeId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Permission mode id for the generation agent (unattended/bypass modes only - anything else falls back to the provider's unattended default, so generation never stalls). Defaults to your own mode when generating with your provider.",
          ),
        projectId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Project to file the artifact under, as the project's root directory path. Defaults to your workspace's project.",
          ),
      },
      outputSchema: {
        artifactId: z.string(),
        name: z.string(),
        status: z.string(),
        provider: z.string(),
        model: z.string().nullable(),
        thinkingOptionId: z.string().nullable(),
        modeId: z.string().nullable(),
        projectId: z.string(),
        guidance: z.string(),
      },
    },
    async (input: {
      name?: string;
      description: string;
      provider?: string;
      model?: string;
      thinkingOptionId?: string;
      modeId?: string;
      projectId?: string;
    }) => {
      const artifactService = options.artifactService;
      if (!artifactService) {
        throw new Error("Artifact service is not available on this daemon");
      }

      const callerAgent = callerAgentId ? agentManager.getAgent(callerAgentId) : null;
      const { provider, model } = resolveArtifactProviderModel({
        providerArg: input.provider,
        modelArg: input.model,
        callerProvider: callerAgent?.provider,
        callerModel: callerAgent?.config.model,
      });
      const { thinkingOptionId, modeId } = resolveArtifactGenerationSettings({
        provider,
        thinkingOptionIdArg: input.thinkingOptionId,
        modeIdArg: input.modeId,
        callerProvider: callerAgent?.provider,
        callerThinkingOptionId: callerAgent?.config.thinkingOptionId,
        callerModeId: callerAgent?.config.modeId,
      });
      const name = input.name?.trim() || deriveArtifactName(input.description);

      const providerEntry = (await providerSnapshotManager.listProviders({ wait: true })).find(
        (entry) => entry.provider === provider,
      );
      if (!providerEntry?.enabled) {
        throw new Error(
          `Provider "${provider}" is not available. Call list_providers for options.`,
        );
      }

      const resolvedThinkingOptionId = resolveEffortOrDropInherited({
        requested: thinkingOptionId,
        explicit: Boolean(input.thinkingOptionId),
        models: providerEntry.models,
        model,
      });

      const projectId = await resolveArtifactProjectId({
        projectIdArg: input.projectId,
        callerWorkspaceId: callerAgent?.workspaceId,
        workspaceRegistry: options.workspaceRegistry,
        projectRegistry: options.projectRegistry,
      });

      // When the artifact inherits the caller's brain (no explicit provider
      // override), it also inherits the caller's personality identity so the
      // card shows who generated it, matching the create sheet.
      const inheritedIdentity = resolveInheritedArtifactIdentity({
        providerOverridden: input.provider !== undefined,
        snapshot: callerAgent?.config.profileSnapshot,
      });

      const artifact = await artifactService.create({
        name,
        description: input.description,
        projectId,
        provider,
        ...(model ? { model } : {}),
        ...(resolvedThinkingOptionId ? { thinkingOptionId: resolvedThinkingOptionId } : {}),
        ...(modeId ? { modeId } : {}),
        ...sourceForArtifactCaller(callerAgent),
        ...inheritedIdentity,
      });
      options.emitArtifactCreated?.(artifact);

      return {
        content: [],
        structuredContent: ensureValidJson({
          artifactId: artifact.id,
          name: artifact.name,
          status: artifact.status,
          provider,
          model: artifact.generationModel,
          thinkingOptionId: artifact.generationThinkingOptionId ?? null,
          modeId: artifact.generationModeId ?? null,
          projectId: artifact.projectId,
          guidance:
            'Generation runs unattended in the background; the artifact appears in the Artifacts screen and flips to "ready" when done. You do not need to wait or poll.',
        }),
      };
    },
  );

  registerTool(
    "list_artifacts",
    {
      title: "List artifacts",
      description:
        "List generated artifacts with their ids, status, and generation settings, optionally filtered by project.",
      inputSchema: {
        projectId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Filter by project root directory path. Omit to list every project."),
      },
      outputSchema: {
        artifacts: z.array(ArtifactToolSummarySchema),
      },
    },
    async ({ projectId }) => {
      const artifactService = options.artifactService;
      if (!artifactService) {
        throw new Error("Artifact service is not available on this daemon");
      }
      const artifacts = (await artifactService.list(projectId)).map(toArtifactToolSummary);
      return {
        content: [],
        structuredContent: ensureValidJson({ artifacts }),
      };
    },
  );

  registerTool(
    "inspect_artifact",
    {
      title: "Inspect artifact",
      description: "Inspect an artifact and its generation run history.",
      inputSchema: {
        artifactId: z
          .string()
          .trim()
          .min(1)
          .describe("Artifact to inspect; call list_artifacts for ids."),
      },
      outputSchema: {
        ...StoredArtifactSchema.shape,
        data: z.json().nullable(),
      },
    },
    async ({ artifactId }) => {
      const artifactService = options.artifactService;
      if (!artifactService) {
        throw new Error("Artifact service is not available on this daemon");
      }
      const record = await artifactService.inspect(artifactId);
      // Data rides along only when the HTML is readable. An artifact that
      // needs repair or is mid-generation has no trustworthy data block, and
      // failing the whole inspect would hide the very record (repairAvailable,
      // status) that tells the agent what to do next.
      const data =
        record.status === "ready" && !record.repairAvailable
          ? await artifactService.getData(artifactId)
          : null;
      return {
        content: [],
        structuredContent: ensureValidJson({ ...record, data }),
      };
    },
  );

  registerTool(
    "update_artifact_data",
    {
      title: "Update artifact data",
      description:
        "Replace only an artifact's dedicated JSON data block. Use inspect_artifact first to learn its current data, then send the complete replacement data. This never changes the artifact's HTML, UI, CSS, or JavaScript. Artifacts made before the data contract may need regeneration first.",
      inputSchema: {
        artifactId: z
          .string()
          .trim()
          .min(1)
          .describe("Artifact to update; call inspect_artifact first for its data contract."),
        data: z.json().describe("Complete JSON data replacement for the artifact."),
      },
      outputSchema: ArtifactToolSummarySchema.shape,
    },
    async ({ artifactId, data }: { artifactId: string; data: unknown }) => {
      const artifactService = options.artifactService;
      if (!artifactService) {
        throw new Error("Artifact service is not available on this daemon");
      }
      const updated = await artifactService.updateData(artifactId, data);
      options.emitArtifactUpdated?.(updated);
      return {
        content: [],
        structuredContent: ensureValidJson(toArtifactToolSummary(updated)),
      };
    },
  );

  registerTool(
    "update_artifact",
    {
      title: "Update artifact",
      description:
        "Edit an artifact's metadata - name, prompt, project, provider, model, effort - WITHOUT re-running generation. Call generate_artifact afterwards to re-generate with the new settings.",
      inputSchema: {
        artifactId: z
          .string()
          .trim()
          .min(1)
          .describe("Artifact to edit; call list_artifacts for ids."),
        name: z.string().trim().min(1).optional().describe("New name."),
        description: z.string().trim().min(1).optional().describe("New generation prompt."),
        provider: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("New provider, as <provider> or <provider>/<model>."),
        model: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe("New model id (null to clear back to the provider default)."),
        thinkingOptionId: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe(`New effort (null to clear). ${EFFORT_INPUT_DESCRIPTION}`),
        projectId: z.string().trim().min(1).optional().describe("New project root directory path."),
      },
      outputSchema: ArtifactToolSummarySchema.shape,
    },
    async (input: ArtifactUpdateToolInput) => {
      const artifactService = options.artifactService;
      if (!artifactService) {
        throw new Error("Artifact service is not available on this daemon");
      }
      const existing = await requireArtifact(artifactService, input.artifactId);
      const targets = resolveArtifactUpdateTargets(input, existing);
      if (targets.provider) {
        const entry = (await providerSnapshotManager.listProviders({ wait: true })).find(
          (candidate) => candidate.provider === targets.provider,
        );
        if (!entry?.enabled) {
          throw new Error(
            `Provider "${targets.provider}" is not available. Call list_providers for options.`,
          );
        }
      }
      const effortModels =
        input.thinkingOptionId && targets.effortProvider
          ? await listProviderModels(targets.effortProvider)
          : [];
      const thinkingPatch = resolveArtifactUpdateEffort({
        requested: input.thinkingOptionId,
        models: effortModels,
        model: targets.effortModel,
      });
      const updated = await artifactService.update(
        buildArtifactUpdateServiceInput(input, targets, thinkingPatch),
      );
      options.emitArtifactUpdated?.(updated);
      return {
        content: [],
        structuredContent: ensureValidJson(toArtifactToolSummary(updated)),
      };
    },
  );

  registerTool(
    "generate_artifact",
    {
      title: "Generate artifact",
      description:
        "Re-run generation for an existing artifact using its stored settings (prompt, provider, model, effort). Edit those first via update_artifact. Generation runs unattended in the background.",
      inputSchema: {
        artifactId: z
          .string()
          .trim()
          .min(1)
          .describe("Artifact to regenerate; call list_artifacts for ids."),
      },
      outputSchema: {
        ...ArtifactToolSummarySchema.shape,
        guidance: z.string(),
      },
    },
    async ({ artifactId }) => {
      const artifactService = options.artifactService;
      if (!artifactService) {
        throw new Error("Artifact service is not available on this daemon");
      }
      const existing = await requireArtifact(artifactService, artifactId);
      if (existing.status === "generating") {
        throw new Error(
          `Artifact ${artifactId} is already generating. Wait for it to finish or cancel it from the Artifacts screen first.`,
        );
      }
      const artifact = await artifactService.regenerate(artifactId);
      options.emitArtifactUpdated?.(artifact);
      return {
        content: [],
        structuredContent: ensureValidJson({
          ...toArtifactToolSummary(artifact),
          guidance:
            'Generation runs unattended in the background; the artifact appears in the Artifacts screen and flips to "ready" when done. You do not need to wait or poll.',
        }),
      };
    },
  );
}
