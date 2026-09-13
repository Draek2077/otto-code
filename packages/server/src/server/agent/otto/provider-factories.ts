import type { Logger } from "pino";
import type { OttoToolGroup } from "@otto-code/protocol/provider-config";
import { resolveStoredOttoToolGroups } from "@otto-code/protocol/provider-config";
import type { AgentClient } from "../agent-sdk-types.js";
import type { ProviderOverride } from "../provider-launch-config.js";
import { OpenAICompatAgentClient } from "../providers/openai-compat-agent.js";
import { resolveProjectRootForCwd } from "../context-management/context-management-service.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type { ManagedProcessRegistry } from "../../managed-processes/managed-processes.js";
import type { BrainProviderEndpoint } from "../../brain/brain-manager.js";

export { OPENAI_COMPAT_EXTENDS } from "../providers/openai-compat-agent.js";

/**
 * Resolves the local AI host's OpenAI-compatible endpoint from the brain
 * settings. Synchronous: the provider calls it per request so a host that was
 * just stopped reports unavailable immediately.
 */
export type BrainProviderEndpointResolver = () => BrainProviderEndpoint;

interface ClientFactoryOptions {
  logger: Logger;
  workspaceGitService?: Pick<WorkspaceGitService, "resolveRepoRoot">;
  managedProcesses?: ManagedProcessRegistry;
}

interface BrainClientOptions extends ClientFactoryOptions {
  providerOverride?: ProviderOverride;
  brainEndpoint?: BrainProviderEndpointResolver;
}

interface OpenAICompatClientOptions extends ClientFactoryOptions {
  providerId: string;
  label: string;
  override: ProviderOverride;
}

/**
 * A provider override's Otto tool-group selection, in whichever taxonomy it was
 * written in. undefined = every group.
 *
 * COMPAT(ottoToolGroupsV2): added in v0.8.20. Drop the legacy argument when the
 * floor is >= v0.8.20.
 */
function resolveProviderToolGroups(
  override: Pick<ProviderOverride, "ottoToolGroups" | "ottoToolGroupsV2"> | undefined,
): OttoToolGroup[] | undefined {
  return resolveStoredOttoToolGroups({
    v2: override?.ottoToolGroupsV2,
    legacy: override?.ottoToolGroups,
  });
}

/**
 * The local AI host. An OpenAI-compatible client like any custom endpoint,
 * except the URL and credential come from the brain settings rather than
 * provider config, so there is nothing for the operator to configure there.
 * Its own function rather than an inline factory: the override reads alone
 * carry the whole map past the complexity ceiling.
 */
export function createOttoBrainClient({ logger, ...options }: BrainClientOptions): AgentClient {
  const override = options.providerOverride;
  return new OpenAICompatAgentClient({
    logger,
    providerId: OTTO_BRAIN_PROVIDER_ID,
    label: OTTO_BRAIN_LABEL,
    resolveProjectRoot: buildProjectRootResolver(options.workspaceGitService),
    resolveEndpoint: () => resolveBrainEndpoint(options.brainEndpoint),
    ottoToolGroups: resolveProviderToolGroups(override),
    mcpServers: override?.mcpServers,
    mcpToolPermissions: override?.mcpToolPermissions,
    // Local models benefit from a much smaller retained tail and a bounded
    // handoff. External OpenAI-compatible providers retain their existing
    // conservative defaults; explicit Brain overrides still win.
    compaction: {
      keepRecentTokens: 6_000,
      summaryMaxTokens: 4_000,
      ...override?.compaction,
    },
    reasoningEffortMode: "toggle",
    maxToolRounds: override?.maxToolRounds,
    actionBreaker: override?.actionBreaker ?? null,
    maxRoundTextChars: override?.maxRoundTextChars,
    midSessionContextUpdates: override?.midSessionContextUpdates,
    managedProcesses: options.managedProcesses,
  });
}

/**
 * Repo-root resolver for the payload-owning provider's tool loop, or null when
 * the daemon has no git service to ask. Same resolution the spawn-time
 * instruction loader uses (`bootstrap.ts`), so a file injected mid-session is
 * headed with the same project-relative path it would have had at spawn.
 */
function buildProjectRootResolver(
  workspaceGitService: Pick<WorkspaceGitService, "resolveRepoRoot"> | undefined,
): ((cwd: string) => Promise<string>) | undefined {
  if (!workspaceGitService) return undefined;
  return (cwd) => resolveProjectRootForCwd(cwd, (dir) => workspaceGitService.resolveRepoRoot(dir));
}

export const OTTO_BRAIN_PROVIDER_ID = "otto-brain";
const OTTO_BRAIN_LABEL = "Otto Brain";

/**
 * The brain endpoint, or a throw carrying the operator-facing reason it is
 * unreachable. Throwing is the contract: the snapshot manager turns it into the
 * provider's error state, which is what shows a red dot and an empty model list
 * instead of a stale "available".
 */
function resolveBrainEndpoint(resolver: BrainProviderEndpointResolver | undefined) {
  const endpoint = resolver?.() ?? {
    state: "unavailable" as const,
    reason: "Otto Brain is not available on this host.",
  };
  if (endpoint.state === "unavailable") {
    throw new Error(endpoint.reason);
  }
  return {
    baseUrl: endpoint.baseUrl,
    apiKey: endpoint.apiKey,
    dispatcher: endpoint.dispatcher,
  };
}

export function createOpenAICompatClient({
  logger,
  providerId,
  label,
  override,
  ...options
}: OpenAICompatClientOptions): AgentClient {
  return new OpenAICompatAgentClient({
    logger,
    providerId,
    label,
    env: override.env,
    resolveProjectRoot: buildProjectRootResolver(options.workspaceGitService),
    ottoToolGroups: resolveProviderToolGroups(override),
    mcpServers: override.mcpServers,
    mcpToolPermissions: override.mcpToolPermissions,
    compaction: override.compaction,
    maxToolRounds: override.maxToolRounds,
    actionBreaker: override.actionBreaker ?? null,
    maxRoundTextChars: override.maxRoundTextChars,
    midSessionContextUpdates: override.midSessionContextUpdates,
    managedProcesses: options.managedProcesses,
  });
}
