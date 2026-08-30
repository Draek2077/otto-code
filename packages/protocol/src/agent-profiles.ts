import { PROFILE_ROLES, type AgentPersonality, type ProfileRole } from "./messages.js";

// Pure, dependency-free personality helpers shared by the daemon (spawn-time
// resolution) and the app (picker availability + role filtering). Effort
// resolution is NOT here - it needs the model's advertised thinking options and
// lives with the daemon's effort resolver; availability does not depend on it.

const ROLE_SET: ReadonlySet<string> = new Set(PROFILE_ROLES);

// Retired role names, mapped to their canonical replacement. "worker" was split
// into "writer" (fast small-text generation) and "coder" (sub-agent coding); a
// personality that still carries the old tag resolves to "coder", the closer
// heir of what a worker did. Normalization applies these before filtering so
// personalities persisted before the split keep a real role.
const LEGACY_ROLE_ALIASES: Readonly<Record<string, ProfileRole>> = {
  worker: "coder",
};

export function isProfileRole(value: string): value is ProfileRole {
  return ROLE_SET.has(value);
}

/**
 * Filter an arbitrary role array (roles ride the wire as plain strings) down to
 * the known set, deduped and returned in canonical `PROFILE_ROLES` order.
 * Retired role names are mapped through `LEGACY_ROLE_ALIASES`; anything else
 * unknown (e.g. a role from a newer peer) is dropped rather than trusted.
 */
export function normalizeProfileRoles(roles: readonly string[] | undefined): ProfileRole[] {
  if (!roles || roles.length === 0) {
    return [];
  }
  const present = new Set<ProfileRole>();
  for (const raw of roles) {
    const canonical = LEGACY_ROLE_ALIASES[raw] ?? (isProfileRole(raw) ? raw : null);
    if (canonical) {
      present.add(canonical);
    }
  }
  return PROFILE_ROLES.filter((role) => present.has(role));
}

export function profileHasRole(
  personality: Pick<AgentPersonality, "roles">,
  role: ProfileRole,
): boolean {
  return normalizeProfileRoles(personality.roles).includes(role);
}

/**
 * Resolve one roster entry from either identifier a caller might hold.
 *
 * Two kinds of caller reach the roster and they hold different things. A model
 * reads `list_agent_profiles` and passes the display name it saw. Daemon-internal
 * callers (orchestration role resolution, a stored schedule binding) already
 * hold the stable id and must not round-trip through a name: names carry no
 * uniqueness constraint, so a name lookup can land on a different entry than the
 * one the caller meant.
 *
 * Id is checked first because ids are opaque and unique, so an id match is never
 * ambiguous. The exact-name pass comes before the case-insensitive one so an
 * exact match always wins over a differently-cased near-miss.
 */
export function findProfileByRef<T extends { id: string; name: string }>(
  roster: readonly T[],
  ref: string,
): T | undefined {
  const trimmed = ref.trim();
  if (!trimmed) {
    return undefined;
  }
  return (
    roster.find((entry) => entry.id === trimmed) ??
    roster.find((entry) => entry.name === trimmed) ??
    roster.find((entry) => entry.name.toLowerCase() === trimmed.toLowerCase())
  );
}

// Two behavioral tiers, not a hard gate. Coordinators delegate - they converse,
// plan, and launch other chats/personality profiles. Focused personalities lift a single
// thing someone is waiting on and should stay on task. A personality that
// carries ANY coordinator role counts as a coordinator (a chatter+coder can
// both code and delegate). Every agent keeps the same tools; the tier only
// drives the spawn-time role directive and the list_agent_profiles decision aid.
export type ProfileRoleTier = "coordinator" | "focused";

interface ProfileRoleInfo {
  tier: ProfileRoleTier;
  // "Why you'd choose me" - a one-line decision aid surfaced in
  // list_agent_profiles so a deciding agent can self-select a role by intent.
  guidance: string;
}

export const PROFILE_ROLE_INFO: Readonly<Record<ProfileRole, ProfileRoleInfo>> = {
  // ── Surfaces ──────────────────────────────────────────────────────────────
  chatter: {
    tier: "coordinator",
    guidance:
      "Interactive driver - converse, plan, and delegate. Pick to run a chat or coordinate work.",
  },
  artificer: {
    tier: "coordinator",
    guidance:
      "Builds and manages artifacts; may run multi-step work to produce them. Pick for artifact creation.",
  },
  scheduler: {
    tier: "coordinator",
    guidance:
      "Creates and manages schedules; may orchestrate recurring or multi-step jobs. Pick for scheduling.",
  },
  // ── Thinking specialists (read-only, structured findings) ────────────────
  researcher: {
    tier: "focused",
    guidance:
      "Read-only surveyor - maps the code or domain and reports files, types, patterns, and gotchas. Pick to gather facts; proposes no solutions and edits nothing.",
  },
  planner: {
    tier: "focused",
    guidance:
      "Planning specialist - turns a goal into a typed, sequenced phase plan for others to execute. Pick to draft an actionable plan; stays on the plan and doesn't dispatch.",
  },
  judger: {
    tier: "focused",
    guidance:
      "Review specialist - evaluates work or a plan against criteria and returns a structured verdict. Pick for a focused review; stays on task.",
  },
  advisor: {
    tier: "focused",
    guidance:
      "Read-only second opinion - weighs the trade-offs and returns one recommendation. Pick for advice; never edits and does not fan out.",
  },
  // ── Making specialists (produce code, design, or text) ───────────────────
  coder: {
    tier: "focused",
    guidance:
      "Focused implementer - writes code for one sub-task others are waiting on. Pick to get a coding job done; stays on task.",
  },
  designer: {
    tier: "focused",
    guidance:
      "Design maker - styling and layout plus the human-skill text (copy, naming). Pick for the look-and-feel or the words; stays on task.",
  },
  writer: {
    tier: "focused",
    guidance:
      "Fast small-text specialist - commit messages, summaries, names. Pick for quick text; stays on the one task.",
  },
  // ── Conductor ─────────────────────────────────────────────────────────────
  orchestrator: {
    tier: "coordinator",
    guidance:
      "The sole conductor - plans team-shaped work, dispatches typed tasks to the right teammates, gathers, and synthesizes. Pick to coordinate a multi-chat workflow.",
  },
};

/**
 * A personality may launch/coordinate when it carries at least one coordinator
 * role. A personality whose roles are entirely focused (researcher, planner,
 * judger, advisor, coder, designer, writer), or that has no roles at all, is a
 * "lifter": it should finish its task, not fan out.
 */
export function profileCanLaunch(personality: Pick<AgentPersonality, "roles">): boolean {
  return normalizeProfileRoles(personality.roles).some(
    (role) => PROFILE_ROLE_INFO[role].tier === "coordinator",
  );
}

export interface ProfileSelectionSummary {
  tier: ProfileRoleTier;
  canLaunch: boolean;
  /** The "why you'd choose me" blurb - each of the personality's roles, joined. */
  guidance: string;
}

/**
 * Build the selection decision-aid for a personality from its roles: the tier
 * (coordinator if any role coordinates), whether it may launch, and a short
 * multi-role "why choose me" blurb. Surfaced by list_agent_profiles so a
 * deciding agent can pick the right teammate from the list alone.
 */
export function summarizeProfileForSelection(
  personality: Pick<AgentPersonality, "roles">,
): ProfileSelectionSummary {
  const roles = normalizeProfileRoles(personality.roles);
  const canLaunch = roles.some((role) => PROFILE_ROLE_INFO[role].tier === "coordinator");
  return {
    tier: canLaunch ? "coordinator" : "focused",
    canLaunch,
    guidance: roles.map((role) => PROFILE_ROLE_INFO[role].guidance).join(" "),
  };
}

// The conductor's standing directive - the distilled `/epic` method taught to
// the sole orchestrator role at spawn. It chooses direct work, a dedicated
// chat, a suggested task, or an orchestration by the task's actual needs rather than
// treating orchestration as the default. Kept here as one exported constant so
// the wording is testable and shared. See projects/agent-orchestration/agent-orchestration.md.
export const OTTO_WORK_VOCABULARY_DIRECTIVE =
  "Otto work vocabulary: a suggested task is deferred work for the user and does not start work; a chat is an active Otto chat session; a child chat is created by another chat; a Personality is a reusable provider, model, mode, effort, and behavior template; a Workflow coordinates multiple chats; a schedule starts a background chat when due; a heartbeat sends a reminder or prompt and does not start a chat. Use suggest_task for concrete work to preserve for later, create_chat to start one chat now, and start_workflow only for managed multi-chat coordination. Use list_agent_profiles, optionally filtered by roles, before choosing a Personality. Never substitute a harness-native agent-spawn tool for suggest_task, and when a user names an Otto tool exactly, use that exact Otto tool.";

export const ORCHESTRATOR_METHOD_DIRECTIVE =
  "You are the orchestrator - the team's sole conductor. Choose tools because the task needs their specific capability, never because a tool is available or named. " +
  "Do a small, self-contained task directly. Use create_chat only for an independently executable piece of active work that benefits from its own chat. Use suggest_task only to preserve a concrete, out-of-scope follow-up for later. Use start_workflow only when the active work needs a declared multi-chat Workflow with daemon-managed fan-out, gathering, judging, loops, or approval gates. " +
  "For work that genuinely needs a Workflow: (1) if the shape is unclear, dispatch research and planning chats; (2) declare the Workflow with start_workflow - phases typed research/plan/implement/design/verify/gate/deliver, fanning out where several angles help and attaching a judger to grade them, looping until enough pass; (3) put a gate before irreversible or costly steps so the user approves; (4) synthesize the passing results into the deliverable. " +
  "Every phase maps to a teammate's role; if the active team lacks a role a phase needs, say so plainly and stop rather than papering over the gap.";

/**
 * The in-context "role directive" injected into a personality's system prompt at
 * spawn. The orchestrator gets the full conductor method; other coordinators
 * (chatter/artificer/scheduler) get a lighter delegate nudge; focused personalities
 * are told to stay on the task someone is waiting on. Roleless spawns get
 * nothing. This is guidance, not a gate - the tools stay available either way.
 */
export function composeRoleFocusDirective(
  roles: readonly string[] | undefined,
): string | undefined {
  const normalized = normalizeProfileRoles(roles);
  if (normalized.length === 0) {
    return undefined;
  }
  const roleList = normalized.join(", ");
  if (normalized.includes("orchestrator")) {
    return `${ORCHESTRATOR_METHOD_DIRECTIVE} (Your roles: ${roleList}.)`;
  }
  if (normalized.some((role) => PROFILE_ROLE_INFO[role].tier === "coordinator")) {
    return `You are a coordinator personality (roles: ${roleList}). You front interactive work and may delegate when the task benefits from it: use list_agent_profiles to see who else is available, then either do the work directly, create a child chat for an independent active piece, or hand off genuinely multi-chat work to the team's orchestrator.`;
  }
  return `You are a focused personality (roles: ${roleList}). Someone is waiting on this specific task - stay on it and finish it. You can still call list_agent_profiles to see the roster, but don't create child chats or start side workflows unless it is genuinely essential to completing this job.`;
}

export type PersonalityUnavailableCode =
  | "provider-missing"
  | "provider-disabled"
  | "provider-not-ready"
  | "model-missing"
  | "mode-missing";

// Structural view of the target provider's snapshot entry, so both the app's
// snapshot shape and the daemon's ProviderSnapshotEntry can feed this without
// importing each other's types.
export interface ProfileAvailabilityInput {
  /** Provider snapshot status, or undefined when the provider is absent entirely. */
  providerStatus: "ready" | "loading" | "error" | "unavailable" | undefined;
  providerEnabled: boolean | undefined;
  modelIds: readonly string[] | undefined;
  modeIds: readonly string[] | undefined;
}

export type ProfileAvailability =
  | { available: true }
  | { available: false; code: PersonalityUnavailableCode; reason: string };

/**
 * Decide whether a personality is usable against a provider's current snapshot.
 * A personality is out of commission the moment any bound setting can't resolve:
 * provider absent/disabled/not-ready, model gone, or an explicit mode missing.
 * The caller grays it out in pickers and hard-fails it in automation.
 *
 * `model` is optional because the stored template is an `AgentProfile`, which
 * may name no model at all ("use whatever this provider defaults to"). Absent
 * means the provider only has to advertise SOME model; the concrete id is
 * chosen at resolution time, not here.
 */
export function checkProfileAvailability(
  personality: { provider: string; model?: string | undefined; modeId?: string | undefined },
  input: ProfileAvailabilityInput,
): ProfileAvailability {
  if (input.providerStatus === undefined) {
    return {
      available: false,
      code: "provider-missing",
      reason: `Provider "${personality.provider}" is not configured on this host.`,
    };
  }
  if (input.providerEnabled === false) {
    return {
      available: false,
      code: "provider-disabled",
      reason: `Provider "${personality.provider}" is disabled.`,
    };
  }
  if (input.providerStatus !== "ready") {
    return {
      available: false,
      code: "provider-not-ready",
      reason: `Provider "${personality.provider}" is not ready (${input.providerStatus}).`,
    };
  }
  const modelIds = input.modelIds ?? [];
  if (personality.model === undefined) {
    if (modelIds.length === 0) {
      return {
        available: false,
        code: "model-missing",
        reason: `Provider "${personality.provider}" advertises no models.`,
      };
    }
  } else if (!modelIds.includes(personality.model)) {
    return {
      available: false,
      code: "model-missing",
      reason: `Model "${personality.model}" is not available from "${personality.provider}".`,
    };
  }
  if (personality.modeId !== undefined && !(input.modeIds ?? []).includes(personality.modeId)) {
    return {
      available: false,
      code: "mode-missing",
      reason: `Mode "${personality.modeId}" is not available from "${personality.provider}".`,
    };
  }
  return { available: true };
}
