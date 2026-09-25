import { z } from "zod";
import type { AgentModelDefinition, AgentProvider } from "../agent-sdk-types.js";
import { resolveProfile, type ResolvedProfileSnapshot } from "../agent-profiles.js";
import {
  composeTeamAndPersonalityPrompt,
  resolveTeamSnapshotForPersonality,
  type ResolvedTeamSnapshot,
} from "../agent-teams.js";
import { findProfileByRef } from "@otto-code/protocol/agent-profiles";
import type { AgentProfile } from "@otto-code/protocol/messages";
import { expandUserPath } from "../../path-utils.js";
import {
  resolveChildAgentCwd,
  resolveScheduleProviderAndModel,
  resolveEffortAgainstModels,
} from "./otto-tool-shared.js";
import type { OttoToolHostDependencies } from "./otto-tool-host-dependencies.js";

export interface ResolvedCreateAgentBrain {
  providerModel: string;
  modeId?: string;
  thinkingOptionId?: string;
  systemPrompt?: string;
  profileSnapshot?: ResolvedProfileSnapshot;
  teamSnapshot?: ResolvedTeamSnapshot;
  featureValues?: Record<string, unknown>;
}

/** Shared caller resolution stays per catalog; domain handlers resolve live state on invocation. */
export function createOttoToolContext(options: OttoToolHostDependencies) {
  const {
    agentManager,
    agentStorage,
    terminalManager,
    scheduleService,
    runService,
    providerSnapshotManager,
    readAgentProfiles,
    readAgentTeams,
    callerAgentId,
    resolveSpeakHandler,
    resolveCallerContext,
    onActivity,
    logger,
  } = options;

  const childLogger = logger.child({ module: "agent", component: "otto-tool-catalog" });

  const callerContext = callerAgentId ? (resolveCallerContext?.(callerAgentId) ?? null) : null;

  const resolveCallerAgent = () => {
    if (!callerAgentId) {
      return null;
    }
    const parentAgent = agentManager.getAgent(callerAgentId);
    if (!parentAgent) {
      throw new Error(`Parent agent ${callerAgentId} not found`);
    }
    return parentAgent;
  };

  const resolveScopedCwd = (requestedCwd?: string, opts?: { required?: boolean }): string => {
    const callerAgent = resolveCallerAgent();
    if (callerAgent) {
      return resolveChildAgentCwd({
        parentCwd: callerAgent.cwd,
        requestedCwd,
        lockedCwd: callerContext?.lockedCwd,
        allowCustomCwd: callerContext?.allowCustomCwd ?? true,
      });
    }

    const trimmedCwd = requestedCwd?.trim();
    if (!trimmedCwd) {
      if (opts?.required) {
        throw new Error("cwd is required");
      }
      throw new Error("cwd is required outside an agent-scoped session");
    }

    return expandUserPath(trimmedCwd);
  };

  const listProviderModels = async (provider: AgentProvider): Promise<AgentModelDefinition[]> => {
    const entry = (await providerSnapshotManager.listProviders({ wait: true })).find(
      (candidate) => candidate.provider === provider,
    );
    return entry?.models ?? [];
  };

  const getPersonalityRoster = (): AgentProfile[] => readAgentProfiles?.() ?? [];

  // Accepts either identifier: the display name a model read from
  // list_agent_profiles, or the stable id a daemon-internal caller already holds.
  const findPersonality = (ref: string): AgentProfile | undefined =>
    findProfileByRef(getPersonalityRoster(), ref);

  const resolveThinkingAgainstProvider = async (
    requested: string,
    providerModel: string,
  ): Promise<string> => {
    const { provider, model } = resolveScheduleProviderAndModel({
      provider: providerModel,
      defaultProvider: providerModel,
    });
    return resolveEffortAgainstModels({
      requested,
      models: await listProviderModels(provider),
      model,
    });
  };

  const resolvePersonalityBrain = async (
    personality: AgentProfile,
    input: {
      providerOverride: string | undefined;
      modeOverride: string | undefined;
      thinkingOverride: string | undefined;
      cwd: string | undefined;
    },
  ): Promise<ResolvedCreateAgentBrain> => {
    const entries = await providerSnapshotManager.listProviders({ cwd: input.cwd, wait: true });
    const resolution = resolveProfile(personality, entries);
    if (resolution.status === "unavailable") {
      throw new Error(
        `Personality "${personality.name}" is unavailable here: ${resolution.reason}`,
      );
    }
    const snapshot = resolution.snapshot;
    const teamSnapshot = resolveTeamSnapshotForPersonality(readAgentTeams?.(), snapshot.profileId);
    const composedPrompt = composeTeamAndPersonalityPrompt(
      teamSnapshot,
      snapshot.systemPrompt,
      snapshot.roles,
    );
    const snapshotProviderModel = snapshot.model
      ? `${snapshot.provider}/${snapshot.model}`
      : snapshot.provider;
    const providerModel = input.providerOverride?.trim() || snapshotProviderModel;
    const modeId = input.modeOverride ?? snapshot.modeId;
    const thinkingOptionId = input.thinkingOverride
      ? await resolveThinkingAgainstProvider(input.thinkingOverride, providerModel)
      : snapshot.thinkingOptionId;
    return {
      providerModel,
      ...(modeId !== undefined ? { modeId } : {}),
      ...(thinkingOptionId !== undefined ? { thinkingOptionId } : {}),
      ...(composedPrompt !== undefined ? { systemPrompt: composedPrompt } : {}),
      profileSnapshot: snapshot,
      ...(teamSnapshot ? { teamSnapshot } : {}),
      ...(snapshot.featureValues ? { featureValues: snapshot.featureValues } : {}),
    };
  };

  // Turn the create_chat personality inputs - a personality name and/or explicit
  // provider/settings - into the concrete provider/model/effort/mode/prompt to
  // spawn with. A personality expands to its resolved snapshot; explicit sibling
  // fields override it per-field (no heuristic substitution). Without a
  // personality this is the plain provider/model path.
  const resolveCreateAgentBrain = async (input: {
    personalityRef: string | undefined;
    providerOverride: string | undefined;
    modeOverride: string | undefined;
    thinkingOverride: string | undefined;
    cwd: string | undefined;
  }): Promise<ResolvedCreateAgentBrain> => {
    if (input.personalityRef) {
      const personality = findPersonality(input.personalityRef);
      if (!personality) {
        const names = getPersonalityRoster()
          .map((candidate) => candidate.name)
          .join(", ");
        throw new Error(
          `Personality "${input.personalityRef}" not found.${names ? ` Available: ${names}.` : " No Personalities are configured on this host."}`,
        );
      }
      return resolvePersonalityBrain(personality, input);
    }

    const providerModel = input.providerOverride?.trim();
    if (!providerModel) {
      throw new Error("Either provider or personality is required.");
    }
    const thinkingOptionId = input.thinkingOverride
      ? await resolveThinkingAgainstProvider(input.thinkingOverride, providerModel)
      : undefined;
    return {
      providerModel,
      ...(input.modeOverride !== undefined ? { modeId: input.modeOverride } : {}),
      ...(thinkingOptionId !== undefined ? { thinkingOptionId } : {}),
    };
  };

  const AgentCreateWorktreeTargetInputSchema = z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("branch-off"),
        worktreeSlug: z
          .string()
          .min(1)
          .optional()
          .describe("Optional worktree slug/path label. Omit to let Otto generate one."),
        branchName: z
          .string()
          .min(1)
          .optional()
          .describe("Optional git branch name. Defaults to the worktree slug."),
        baseBranch: z
          .string()
          .min(1)
          .optional()
          .describe("Optional base branch. Defaults to the repository default branch."),
      })
      .strict()
      .describe("Branch off a new branch."),
    z
      .object({
        kind: z.literal("checkout-branch"),
        branch: z.string().min(1).describe("Existing branch to check out."),
        worktreeSlug: z
          .string()
          .min(1)
          .optional()
          .describe("Optional worktree slug/path label. Omit to derive one from the branch."),
      })
      .strict()
      .describe("Check out an existing branch."),
    z
      .object({
        kind: z.literal("checkout-pr"),
        githubPrNumber: z.number().int().positive().describe("Change request number."),
        forge: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Git host the change request lives on, for example github or bitbucket. Defaults to the repository's resolved forge.",
          ),
      })
      .strict()
      .describe("Check out a change request (pull request / merge request)."),
  ]);
  return {
    options,
    agentManager,
    agentStorage,
    terminalManager,
    scheduleService,
    runService,
    providerSnapshotManager,
    readAgentProfiles,
    readAgentTeams,
    callerAgentId,
    resolveSpeakHandler,
    resolveCallerContext,
    onActivity,
    logger,
    childLogger,
    callerContext,
    resolveCallerAgent,
    resolveScopedCwd,
    listProviderModels,
    getPersonalityRoster,
    findPersonality,
    resolveThinkingAgainstProvider,
    resolvePersonalityBrain,
    resolveCreateAgentBrain,
    AgentCreateWorktreeTargetInputSchema,
  };
}

export type OttoToolContext = ReturnType<typeof createOttoToolContext>;
