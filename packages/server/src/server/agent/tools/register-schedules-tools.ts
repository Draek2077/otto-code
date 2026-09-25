import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import type { AgentProvider } from "../agent-sdk-types.js";
import { expandUserPath } from "../../path-utils.js";
import {
  ScheduleRunSchema,
  ScheduleSummarySchema,
  StoredScheduleSchema,
  type ScheduleCadence,
  type UpdateScheduleInput,
} from "@otto-code/protocol/schedule/types";
import { AgentProviderEnum, parseDurationString, toScheduleSummary } from "../mcp-shared.js";
import {
  resolveScheduleProviderAndModel,
  resolveEffortOrDropInherited,
  EFFORT_INPUT_DESCRIPTION,
  resolveEffortAgainstModels,
} from "./otto-tool-shared.js";
import type { OttoToolContext } from "./otto-tool-context.js";
import type { RegisterOttoTool } from "./types.js";

function resolveScheduleUpdateProviderAndModel(params: {
  provider?: string;
  model?: string | null;
}): { provider?: string; model?: string | null } {
  const providerInput = params.provider?.trim();
  const modelInput = typeof params.model === "string" ? params.model.trim() : params.model;

  if (params.model !== undefined && modelInput === "") {
    throw new Error("model cannot be empty");
  }

  if (!providerInput) {
    return params.model !== undefined ? { model: modelInput } : {};
  }

  const slashIndex = providerInput.indexOf("/");
  if (slashIndex === -1) {
    return {
      provider: providerInput,
      ...(params.model !== undefined ? { model: modelInput } : {}),
    };
  }

  const provider = providerInput.slice(0, slashIndex).trim();
  const modelFromProvider = providerInput.slice(slashIndex + 1).trim();
  if (!provider || !modelFromProvider) {
    throw new Error("provider must be <provider> or <provider>/<model>");
  }
  if (params.model === null) {
    throw new Error("provider specifies a model but model is null");
  }
  if (typeof modelInput === "string" && modelInput !== modelFromProvider) {
    throw new Error("Conflicting model values provided");
  }

  return {
    provider,
    model: modelInput ?? modelFromProvider,
  };
}

interface ScheduleUpdateToolInput {
  id: string;
  every?: string;
  cron?: string;
  timezone?: string;
  name?: string | null;
  prompt?: string;
  maxRuns?: number | null;
  provider?: string;
  agentProfile?: string | null;
  model?: string | null;
  mode?: string | null;
  thinkingOptionId?: string | null;
  cwd?: string;
  expiresIn?: string;
  clearExpires?: boolean;
}

function normalizeScheduleCadenceArg(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed;
}

function normalizeScheduleTimeZoneArg(value: string | undefined): string | undefined {
  return normalizeScheduleCadenceArg(value);
}

function resolveScheduleUpdateCadence(input: ScheduleUpdateToolInput): ScheduleCadence | undefined {
  const every = normalizeScheduleCadenceArg(input.every);
  const cron = normalizeScheduleCadenceArg(input.cron);
  const timeZone = normalizeScheduleTimeZoneArg(input.timezone);

  if (every !== undefined && cron !== undefined) {
    throw new Error("Specify at most one of every or cron");
  }
  if (timeZone !== undefined && cron === undefined) {
    throw new Error("timezone can only be used with cron");
  }
  if (every !== undefined) {
    return { type: "every", everyMs: parseDurationString(every) };
  }
  if (cron !== undefined) {
    return {
      type: "cron",
      expression: cron,
      ...(timeZone !== undefined ? { timezone: timeZone } : {}),
    };
  }
  return undefined;
}

function resolveScheduleUpdateExpiresAt(input: ScheduleUpdateToolInput): string | null | undefined {
  if (input.expiresIn !== undefined && input.clearExpires) {
    throw new Error("Specify at most one of expiresIn or clearExpires");
  }
  if (input.expiresIn !== undefined) {
    return new Date(Date.now() + parseDurationString(input.expiresIn)).toISOString();
  }
  if (input.clearExpires) {
    return null;
  }
  return undefined;
}

function buildScheduleUpdateInput(input: ScheduleUpdateToolInput): UpdateScheduleInput {
  const cadence = resolveScheduleUpdateCadence(input);
  const expiresAt = resolveScheduleUpdateExpiresAt(input);
  const providerModelPatch = resolveScheduleUpdateProviderAndModel({
    provider: input.provider,
    model: input.model,
  });
  const newAgentConfig = {
    ...(providerModelPatch.provider !== undefined ? { provider: providerModelPatch.provider } : {}),
    // Renamed on the tool surface only. `personality` is the persisted config
    // field name and a wire field, so it keeps its name on the way out.
    ...(input.agentProfile !== undefined ? { agentProfile: input.agentProfile } : {}),
    ...(providerModelPatch.model !== undefined ? { model: providerModelPatch.model } : {}),
    ...(input.mode !== undefined ? { modeId: input.mode } : {}),
    ...(input.thinkingOptionId !== undefined ? { thinkingOptionId: input.thinkingOptionId } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
  };

  return {
    id: input.id,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(cadence !== undefined ? { cadence } : {}),
    ...(input.maxRuns !== undefined ? { maxRuns: input.maxRuns } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(Object.keys(newAgentConfig).length > 0 ? { newAgentConfig } : {}),
  };
}

type Dependencies = Pick<
  OttoToolContext,
  | "scheduleService"
  | "callerAgentId"
  | "resolveCallerAgent"
  | "listProviderModels"
  | "resolveCreateAgentBrain"
> & { registerTool: RegisterOttoTool };

export function registerSchedulesTools({
  scheduleService,
  callerAgentId,
  resolveCallerAgent,
  listProviderModels,
  resolveCreateAgentBrain,
  registerTool,
}: Dependencies): void {
  const buildCronScheduleCadence = (input: {
    cron: string | undefined;
    timezone?: string;
  }): ScheduleCadence => {
    const expression = input.cron?.trim() ?? "";
    if (!expression) {
      throw new Error("cron is required");
    }
    const timezone = normalizeScheduleTimeZoneArg(input.timezone);
    return {
      type: "cron",
      expression,
      ...(timezone !== undefined ? { timezone } : {}),
    };
  };

  const buildScheduleExpiry = (expiresIn: string | undefined): string | undefined => {
    return expiresIn === undefined
      ? undefined
      : new Date(Date.now() + parseDurationString(expiresIn)).toISOString();
  };

  const buildCallerAgentScheduleConfigExtras = (
    callerAgent: NonNullable<ReturnType<typeof resolveCallerAgent>>,
  ): Record<string, unknown> => {
    return {
      ...(callerAgent.config.thinkingOptionId
        ? { thinkingOptionId: callerAgent.config.thinkingOptionId }
        : {}),
      ...(callerAgent.config.approvalPolicy
        ? { approvalPolicy: callerAgent.config.approvalPolicy }
        : {}),
      ...(callerAgent.config.sandboxMode ? { sandboxMode: callerAgent.config.sandboxMode } : {}),
      ...(typeof callerAgent.config.networkAccess === "boolean"
        ? { networkAccess: callerAgent.config.networkAccess }
        : {}),
      ...(typeof callerAgent.config.webSearch === "boolean"
        ? { webSearch: callerAgent.config.webSearch }
        : {}),
      // Deliberately not `title`. Everything else here is runtime config worth
      // inheriting; the title is a label, and stamping the caller's chat title
      // onto the schedule made every run of every agent-created schedule show up
      // as "Parent agent" instead of a title derived from the schedule's prompt
      // (resolveScheduleAgentTitle prefers config.title over the prompt).
      ...(callerAgent.config.extra ? { extra: callerAgent.config.extra } : {}),
      ...(callerAgent.config.featureValues
        ? { featureValues: callerAgent.config.featureValues }
        : {}),
      ...(callerAgent.config.systemPrompt ? { systemPrompt: callerAgent.config.systemPrompt } : {}),
      ...(callerAgent.config.mcpServers ? { mcpServers: callerAgent.config.mcpServers } : {}),
    };
  };

  const buildCallerAgentScheduleConfig = (
    callerAgent: NonNullable<ReturnType<typeof resolveCallerAgent>>,
    params?: { provider?: string; cwd?: string },
  ) => {
    const hasProviderOverride = params?.provider !== undefined;
    const resolvedProviderModel = hasProviderOverride
      ? resolveScheduleProviderAndModel({
          provider: params?.provider,
          defaultProvider: callerAgent.provider,
        })
      : null;
    const resolvedProvider = resolvedProviderModel?.provider ?? callerAgent.provider;
    let resolvedModel: string | undefined;
    if (resolvedProviderModel?.model) {
      resolvedModel = resolvedProviderModel.model;
    } else if (!hasProviderOverride && callerAgent.config.model) {
      resolvedModel = callerAgent.config.model;
    }
    return {
      provider: resolvedProvider,
      cwd: params?.cwd?.trim() ? expandUserPath(params.cwd) : callerAgent.cwd,
      ...(callerAgent.currentModeId && callerAgent.provider === resolvedProvider
        ? {
            modeId: callerAgent.currentModeId,
          }
        : {}),
      ...(resolvedModel ? { model: resolvedModel } : {}),
      ...buildCallerAgentScheduleConfigExtras(callerAgent),
    };
  };

  const resolveNewAgentScheduleTarget = (params?: { provider?: string; cwd?: string }) => {
    // Check the caller first: an agent scheduling work inherits its own
    // provider/model, so demanding an explicit provider before looking would
    // reject the common "schedule this same thing nightly" call.
    const callerAgent = resolveCallerAgent();
    if (callerAgent) {
      return {
        type: "new-agent" as const,
        config: buildCallerAgentScheduleConfig(callerAgent, params),
      };
    }

    if (!params?.provider?.trim()) {
      throw new Error("provider is required when target is new-agent");
    }

    const resolvedProviderModel = resolveScheduleProviderAndModel({
      provider: params?.provider,
      defaultProvider: params.provider,
    });
    return {
      type: "new-agent" as const,
      config: {
        provider: resolvedProviderModel.provider,
        cwd: params?.cwd?.trim() ? expandUserPath(params.cwd) : process.cwd(),
        ...(resolvedProviderModel.model ? { model: resolvedProviderModel.model } : {}),
      },
    };
  };

  // Build a new-agent schedule config from either a Personality binding or a
  // raw provider. A Personality is validated and resolved now (to fill the
  // required provider field and fail fast), and its stable id is stored so each
  // run re-resolves it authoritatively and a later rename cannot break it.
  const buildScheduleNewAgentConfig = async (input: {
    provider?: string;
    agentProfile?: string;
    cwd?: string;
    thinkingOptionId?: string;
    isolation?: "local" | "worktree";
  }) => {
    // Left off the config entirely when omitted: the run resolves `isolation ??
    // "local"`, and materializing the default here would make every stored
    // schedule claim an explicit choice its author never made.
    const isolation = input.isolation ? { isolation: input.isolation } : {};
    const personalityRef = input.agentProfile?.trim();
    if (personalityRef) {
      const brain = await resolveCreateAgentBrain({
        personalityRef,
        providerOverride: input.provider,
        modeOverride: undefined,
        thinkingOverride: input.thinkingOptionId,
        cwd: input.cwd,
      });
      const baseTarget = resolveNewAgentScheduleTarget({
        provider: brain.providerModel,
        cwd: input.cwd,
      });
      return {
        ...baseTarget.config,
        // COMPAT(agentProfileFields): both spellings, same id.
        personality: brain.profileSnapshot?.profileId ?? personalityRef,
        agentProfile: brain.profileSnapshot?.profileId ?? personalityRef,
        ...(brain.modeId !== undefined ? { modeId: brain.modeId } : {}),
        ...(brain.thinkingOptionId !== undefined
          ? { thinkingOptionId: brain.thinkingOptionId }
          : {}),
        ...isolation,
      };
    }

    const baseTarget = resolveNewAgentScheduleTarget({ provider: input.provider, cwd: input.cwd });
    const config: typeof baseTarget.config & {
      thinkingOptionId?: string;
      isolation?: "local" | "worktree";
    } = {
      ...baseTarget.config,
      ...isolation,
    };
    const inheritedEffort =
      typeof config.thinkingOptionId === "string" ? config.thinkingOptionId : undefined;
    const requestedEffort = input.thinkingOptionId ?? inheritedEffort;
    if (requestedEffort) {
      const resolved = resolveEffortOrDropInherited({
        requested: requestedEffort,
        explicit: Boolean(input.thinkingOptionId),
        models: await listProviderModels(config.provider),
        model: config.model,
      });
      if (resolved === undefined) {
        delete config.thinkingOptionId;
      } else {
        config.thinkingOptionId = resolved;
      }
    }
    return config;
  };

  registerTool(
    "create_schedule",
    {
      title: "Create schedule",
      description: "Create a recurring schedule that starts a new agent on a cron cadence.",
      inputSchema: {
        prompt: z.string().trim().min(1, "prompt is required"),
        cron: z.string().trim().min(1, "cron is required"),
        timezone: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("IANA time zone for the cron cadence. For example: America/New_York."),
        name: z.string().optional(),
        provider: AgentProviderEnum.optional().describe(
          "Provider, or provider/model (for example: codex or codex/gpt-5.4). Required unless `agentProfile` is given; when both are given, this overrides the agent profile's provider/model.",
        ),
        agentProfile: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Bind this schedule to an agent profile by name (an id also works). Each run re-resolves the binding against the run workspace and hard-fails if it is unavailable there.",
          ),
        cwd: z.string().optional(),
        thinkingOptionId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            `${EFFORT_INPUT_DESCRIPTION} Defaults to your own effort option when scheduling your provider.`,
          ),
        isolation: z
          .enum(["local", "worktree"])
          .optional()
          .describe(
            "Where each run works. 'local' (default) runs in the schedule's cwd; 'worktree' cuts a fresh Otto-managed worktree per run.",
          ),
        maxRuns: z.number().int().positive().optional(),
        expiresIn: z.string().optional(),
      },
      outputSchema: ScheduleSummarySchema.shape,
    },
    async ({
      prompt,
      cron,
      timezone,
      name,
      provider,
      agentProfile,
      cwd,
      thinkingOptionId,
      isolation,
      maxRuns,
      expiresIn,
    }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      const config = await buildScheduleNewAgentConfig({
        provider,
        agentProfile,
        cwd,
        thinkingOptionId,
        ...(isolation ? { isolation } : {}),
      });

      const expiresAt = buildScheduleExpiry(expiresIn);
      const schedule = await scheduleService.createOrReplace({
        prompt: prompt.trim(),
        cadence: buildCronScheduleCadence({
          cron,
          ...(timezone !== undefined ? { timezone } : {}),
        }),
        target: { type: "new-agent", config },
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(maxRuns === undefined ? {} : { maxRuns }),
        ...(expiresAt === undefined ? {} : { expiresAt }),
      });

      return {
        content: [],
        structuredContent: ensureValidJson(toScheduleSummary(schedule)),
      };
    },
  );

  registerTool(
    "create_heartbeat",
    {
      title: "Create heartbeat",
      description: "Create a recurring heartbeat that sends you a prompt on a cron cadence.",
      inputSchema: {
        prompt: z.string().trim().min(1, "prompt is required"),
        cron: z.string().trim().min(1, "cron is required"),
        timezone: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("IANA time zone for the cron cadence. For example: America/New_York."),
        name: z.string().optional(),
        maxRuns: z.number().int().positive().optional(),
        expiresIn: z.string().optional(),
      },
      outputSchema: ScheduleSummarySchema.shape,
    },
    async ({ prompt, cron, timezone, name, maxRuns, expiresIn }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }
      if (!callerAgentId) {
        throw new Error("create_heartbeat requires an agent-scoped session");
      }
      resolveCallerAgent();

      const expiresAt = buildScheduleExpiry(expiresIn);
      const schedule = await scheduleService.createOrReplace({
        prompt: prompt.trim(),
        cadence: buildCronScheduleCadence({
          cron,
          ...(timezone !== undefined ? { timezone } : {}),
        }),
        target: { type: "agent", agentId: callerAgentId },
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(maxRuns === undefined ? {} : { maxRuns }),
        ...(expiresAt === undefined ? {} : { expiresAt }),
      });

      return {
        content: [],
        structuredContent: ensureValidJson(toScheduleSummary(schedule)),
      };
    },
  );

  // The counterpart to create_heartbeat, and the reason it exists separately
  // from delete_schedule: create_heartbeat stamps the caller as the target, but
  // delete_schedule takes a bare id and would happily let one agent delete
  // another's heartbeat. This one refuses anything the caller does not own.
  registerTool(
    "delete_heartbeat",
    {
      title: "Delete heartbeat",
      description: "Delete one of your own heartbeats.",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ id }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }
      if (!callerAgentId) {
        throw new Error("delete_heartbeat requires an agent-scoped session");
      }

      const schedule = await scheduleService.inspect(id);
      if (schedule.target.type !== "agent" || schedule.target.agentId !== callerAgentId) {
        throw new Error(`Heartbeat ${id} does not belong to caller ${callerAgentId}`);
      }

      await scheduleService.delete(id);
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "list_schedules",
    {
      title: "List schedules",
      description: "List all schedules managed by the daemon.",
      inputSchema: {},
      outputSchema: {
        schedules: z.array(ScheduleSummarySchema),
      },
    },
    async () => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      const schedules = (await scheduleService.list()).map((schedule) =>
        toScheduleSummary(schedule),
      );
      return {
        content: [],
        structuredContent: ensureValidJson({ schedules }),
      };
    },
  );

  registerTool(
    "inspect_schedule",
    {
      title: "Inspect schedule",
      description: "Inspect a schedule and its run history.",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: StoredScheduleSchema.shape,
    },
    async ({ id }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      const schedule = await scheduleService.inspect(id);
      return {
        content: [],
        structuredContent: ensureValidJson(schedule),
      };
    },
  );

  registerTool(
    "pause_schedule",
    {
      title: "Pause schedule",
      description: "Pause an active schedule.",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ id }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      await scheduleService.pause(id);
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "resume_schedule",
    {
      title: "Resume schedule",
      description: "Resume a paused schedule.",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ id }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      await scheduleService.resume(id);
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "delete_schedule",
    {
      title: "Delete schedule",
      description: "Delete a schedule permanently.",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ id }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      await scheduleService.delete(id);
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "update_schedule",
    {
      title: "Update schedule",
      description:
        "Update an existing schedule. Only provided fields are changed; omitted fields remain unchanged.",
      inputSchema: {
        id: z.string(),
        every: z.string().optional().describe("New interval duration string (e.g. 5m, 1h)."),
        cron: z.string().optional().describe("New cron expression."),
        timezone: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "IANA time zone for cron cadence; requires cron. For example: America/New_York.",
          ),
        name: z.string().nullable().optional().describe("New name (null to clear)."),
        prompt: z.string().trim().min(1).optional().describe("New prompt text."),
        maxRuns: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("New max runs limit (null to clear)."),
        provider: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("New provider for new-agent target."),
        agentProfile: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe(
            "Bind (or, with null, unbind) an agent profile by name for the new-agent target - an id also works. Re-resolved at each run.",
          ),
        model: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe("New model for new-agent target (null to clear)."),
        mode: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe("New mode for new-agent target (null to clear)."),
        thinkingOptionId: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe(`New effort for new-agent target (null to clear). ${EFFORT_INPUT_DESCRIPTION}`),
        cwd: z.string().trim().min(1).optional().describe("New cwd for new-agent target."),
        expiresIn: z
          .string()
          .optional()
          .describe("New relative expiry duration (for example: 1h, 2d)."),
        clearExpires: z.boolean().optional().describe("Clear any schedule expiry."),
      },
      outputSchema: StoredScheduleSchema.shape,
    },
    async (input) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      let resolvedInput = input;
      if (typeof input.thinkingOptionId === "string") {
        // Resolve against the provider/model the schedule ends up with -
        // either from this same update or from the stored target.
        const existing = await scheduleService.inspect(input.id);
        const existingConfig =
          existing?.target.type === "new-agent" ? existing.target.config : undefined;
        const providerModelPatch = resolveScheduleUpdateProviderAndModel({
          provider: input.provider,
          model: input.model,
        });
        const provider = providerModelPatch.provider ?? existingConfig?.provider;
        const model =
          providerModelPatch.model !== undefined
            ? (providerModelPatch.model ?? undefined)
            : existingConfig?.model;
        if (provider) {
          resolvedInput = {
            ...input,
            thinkingOptionId: resolveEffortAgainstModels({
              requested: input.thinkingOptionId,
              models: await listProviderModels(provider as AgentProvider),
              model,
            }),
          };
        }
      }

      const schedule = await scheduleService.update(buildScheduleUpdateInput(resolvedInput));

      return {
        content: [],
        structuredContent: ensureValidJson(schedule),
      };
    },
  );

  registerTool(
    "schedule_logs",
    {
      title: "Schedule logs",
      description: "Get the run history (logs) for a schedule.",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: {
        runs: z.array(ScheduleRunSchema),
      },
    },
    async ({ id }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      const runs = await scheduleService.logs(id);
      return {
        content: [],
        structuredContent: ensureValidJson({ runs }),
      };
    },
  );
}
