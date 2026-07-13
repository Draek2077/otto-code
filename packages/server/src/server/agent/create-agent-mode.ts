import type {
  AgentCreateConfigParent,
  AgentCreateConfigUnattendedInput,
  AgentMode,
  AgentProvider,
  ResolveAgentCreateConfigInput,
  ResolveAgentCreateConfigResult,
} from "./agent-sdk-types.js";

export interface ResolveCreateAgentModeInput {
  requestedMode: string | undefined;
  targetProvider: AgentProvider;
  parent: AgentCreateConfigParent | null;
  unattended: boolean;
  // `undefined` = target provider's modes unknown: explicit modes pass through
  // unvalidated, but cross-provider inheritance is still refused.
  availableModes: string[] | undefined;
  // Target provider's own unattended mode id, if it has one. Used to bridge
  // unattended parents into unattended children across providers, and as the
  // coercion target when an unattended run is handed an attended mode.
  targetUnattendedMode: string | undefined;
  // Ids of every unattended (isUnattended) mode the target provider exposes.
  // Lets us tell whether an explicit requested mode is itself safe for an
  // unattended run. Falls back to `targetUnattendedMode` when omitted.
  unattendedModeIds?: readonly string[];
  // A provider-computed, model-aware override for the unattended target. When
  // set and valid for the target provider, it WINS over `targetUnattendedMode`
  // as the coercion target and is treated as an accepted unattended mode (so an
  // explicit request for it on an unattended run is kept). Claude uses this to
  // upgrade the unattended target from `dontAsk` to `auto` when the model +
  // auth path supports the classifier; left unset, the target stays `dontAsk`
  // by list order. A mode not present in `availableModes` is ignored.
  preferredUnattendedModeId?: string;
}

function listModes(modes: string[] | undefined): string {
  if (modes === undefined) {
    return "unknown";
  }
  return modes.length > 0 ? modes.join(", ") : "(none)";
}

function isUnattendedCreateConfigParent(parent: AgentCreateConfigParent): boolean {
  return parent.isUnattended;
}

function formatCreateConfigParentMode(parent: AgentCreateConfigParent): string {
  return parent.modeId ?? "<none>";
}

function formatCreateConfigParentSource(parent: AgentCreateConfigParent): string {
  return `caller (provider '${parent.provider}')`;
}

interface EffectiveUnattendedTarget {
  target: string | undefined;
  unattendedIds: readonly string[];
}

/**
 * Resolve the unattended coercion target and the set of ids that count as
 * "already unattended" for this run. A model-aware preferred target (e.g.
 * Claude upgrading dontAsk → auto) wins over the list-order target, but only
 * when it is actually a mode the target provider exposes. When it wins it also
 * counts as an accepted unattended mode so an explicit request for it on an
 * unattended run is honored rather than coerced away.
 */
function resolveEffectiveUnattendedTarget(
  input: ResolveCreateAgentModeInput,
): EffectiveUnattendedTarget {
  const preferred = input.preferredUnattendedModeId;
  const preferredValid =
    preferred !== undefined &&
    (input.availableModes === undefined || input.availableModes.includes(preferred));
  const baseUnattendedIds =
    input.unattendedModeIds ??
    (input.targetUnattendedMode !== undefined ? [input.targetUnattendedMode] : []);
  if (preferredValid) {
    return {
      target: preferred,
      unattendedIds: baseUnattendedIds.includes(preferred!)
        ? baseUnattendedIds
        : [preferred!, ...baseUnattendedIds],
    };
  }
  return { target: input.targetUnattendedMode, unattendedIds: baseUnattendedIds };
}

export function resolveAndValidateCreateAgentMode(
  input: ResolveCreateAgentModeInput,
): string | undefined {
  const { requestedMode, targetProvider, parent, availableModes } = input;
  const { target: effectiveTarget, unattendedIds: effectiveUnattendedIds } =
    resolveEffectiveUnattendedTarget(input);

  if (requestedMode !== undefined) {
    if (availableModes !== undefined && !availableModes.includes(requestedMode)) {
      throw new Error(
        `Invalid mode '${requestedMode}' for provider '${targetProvider}'. Available modes: ${listModes(availableModes)}`,
      );
    }
    // Unattended runs (schedules, loops, artifacts, unattended-parent spawns)
    // have no client watching to answer approval prompts. An attended mode can
    // still leak in as an explicit request — a personality's default mode, a
    // schedule's stored mode, a last-used chat preference — and honoring it
    // would stall the run forever on the first prompt. Coerce it to the
    // provider's unattended mode; an already-unattended request is kept as-is.
    if (input.unattended && effectiveTarget !== undefined) {
      if (!effectiveUnattendedIds.includes(requestedMode)) {
        return effectiveTarget;
      }
    }
    return requestedMode;
  }

  if (!parent) {
    if (input.unattended && effectiveTarget !== undefined) {
      return effectiveTarget;
    }
    return undefined;
  }

  if (parent.provider === targetProvider) {
    return parent.modeId ?? undefined;
  }

  if (
    (input.unattended || isUnattendedCreateConfigParent(parent)) &&
    effectiveTarget !== undefined
  ) {
    return effectiveTarget;
  }

  throw new Error(
    `cannot inherit mode '${formatCreateConfigParentMode(parent)}' from ${formatCreateConfigParentSource(parent)} for new agent (provider '${targetProvider}'). Pass an explicit mode. Available modes for '${targetProvider}': ${listModes(availableModes)}`,
  );
}

export function resolveDefaultAgentCreateConfig(
  input: ResolveAgentCreateConfigInput,
): ResolveAgentCreateConfigResult {
  const availableModeIds = input.availableModes?.map((mode) => mode.id);
  const unattendedModeIds = input.availableModes?.filter(isUnattendedMode).map((mode) => mode.id);
  return {
    modeId: resolveAndValidateCreateAgentMode({
      requestedMode: input.requestedMode,
      targetProvider: input.provider,
      parent: input.parent,
      unattended: input.unattended,
      availableModes: availableModeIds,
      targetUnattendedMode: unattendedModeIds?.[0],
      unattendedModeIds,
      preferredUnattendedModeId: input.preferredUnattendedModeId,
    }),
    featureValues: input.featureValues,
  };
}

export function isDefaultAgentCreateConfigUnattended(
  input: AgentCreateConfigUnattendedInput,
): boolean {
  if (input.modeId === null) {
    return false;
  }
  return input.availableModes.some((mode) => mode.id === input.modeId && isUnattendedMode(mode));
}

function isUnattendedMode(mode: AgentMode): boolean {
  return mode.isUnattended === true;
}
