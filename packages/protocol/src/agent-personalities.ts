import { PERSONALITY_ROLES, type AgentPersonality, type PersonalityRole } from "./messages.js";

// Pure, dependency-free personality helpers shared by the daemon (spawn-time
// resolution) and the app (picker availability + role filtering). Effort
// resolution is NOT here — it needs the model's advertised thinking options and
// lives with the daemon's effort resolver; availability does not depend on it.

const ROLE_SET: ReadonlySet<string> = new Set(PERSONALITY_ROLES);

// Retired role names, mapped to their canonical replacement. "worker" was split
// into "writer" (fast small-text generation) and "coder" (sub-agent coding); a
// personality that still carries the old tag resolves to "coder", the closer
// heir of what a worker did. Normalization applies these before filtering so
// personalities persisted before the split keep a real role.
const LEGACY_ROLE_ALIASES: Readonly<Record<string, PersonalityRole>> = {
  worker: "coder",
};

export function isPersonalityRole(value: string): value is PersonalityRole {
  return ROLE_SET.has(value);
}

/**
 * Filter an arbitrary role array (roles ride the wire as plain strings) down to
 * the known set, deduped and returned in canonical `PERSONALITY_ROLES` order.
 * Retired role names are mapped through `LEGACY_ROLE_ALIASES`; anything else
 * unknown (e.g. a role from a newer peer) is dropped rather than trusted.
 */
export function normalizePersonalityRoles(roles: readonly string[] | undefined): PersonalityRole[] {
  if (!roles || roles.length === 0) {
    return [];
  }
  const present = new Set<PersonalityRole>();
  for (const raw of roles) {
    const canonical = LEGACY_ROLE_ALIASES[raw] ?? (isPersonalityRole(raw) ? raw : null);
    if (canonical) {
      present.add(canonical);
    }
  }
  return PERSONALITY_ROLES.filter((role) => present.has(role));
}

export function personalityHasRole(
  personality: Pick<AgentPersonality, "roles">,
  role: PersonalityRole,
): boolean {
  return normalizePersonalityRoles(personality.roles).includes(role);
}

// Two behavioral tiers, not a hard gate. Coordinators delegate — they converse,
// plan, and launch other agents/personalities. Focused workers lift a single
// thing someone is waiting on and should stay on task. A personality that
// carries ANY coordinator role counts as a coordinator (a chatter+coder can
// both code and delegate). Every agent keeps the same tools; the tier only
// drives the spawn-time role directive and the list_personalities decision aid.
export type PersonalityRoleTier = "coordinator" | "focused";

interface PersonalityRoleInfo {
  tier: PersonalityRoleTier;
  // "Why you'd choose me" — a one-line decision aid surfaced in
  // list_personalities so a deciding agent can self-select a role by intent.
  guidance: string;
}

export const PERSONALITY_ROLE_INFO: Readonly<Record<PersonalityRole, PersonalityRoleInfo>> = {
  // ── Surfaces ──────────────────────────────────────────────────────────────
  chatter: {
    tier: "coordinator",
    guidance:
      "Interactive driver — converse, plan, and delegate. Pick to run a chat or coordinate work.",
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
  // ── Thinking workers (read-only, structured findings) ─────────────────────
  researcher: {
    tier: "focused",
    guidance:
      "Read-only surveyor — maps the code or domain and reports files, types, patterns, and gotchas. Pick to gather facts; proposes no solutions and edits nothing.",
  },
  planner: {
    tier: "focused",
    guidance:
      "Planning specialist — turns a goal into a typed, sequenced phase plan for others to execute. Pick to draft an actionable plan; stays on the plan and doesn't dispatch.",
  },
  judger: {
    tier: "focused",
    guidance:
      "Review specialist — evaluates work or a plan against criteria and returns a structured verdict. Pick for a focused review; stays on task.",
  },
  advisor: {
    tier: "focused",
    guidance:
      "Read-only second opinion — weighs the trade-offs and returns one recommendation. Pick for advice; never edits and does not fan out.",
  },
  // ── Making workers (produce code, design, or text) ────────────────────────
  coder: {
    tier: "focused",
    guidance:
      "Focused implementer — writes code for one sub-task others are waiting on. Pick to get a coding job done; stays on task.",
  },
  designer: {
    tier: "focused",
    guidance:
      "Design maker — styling and layout plus the human-skill text (copy, naming). Pick for the look-and-feel or the words; stays on task.",
  },
  writer: {
    tier: "focused",
    guidance:
      "Fast small-text specialist — commit messages, summaries, names. Pick for quick text; stays on the one task.",
  },
  // ── Conductor ─────────────────────────────────────────────────────────────
  orchestrator: {
    tier: "coordinator",
    guidance:
      "The sole conductor — plans team-shaped work, dispatches typed tasks to the right teammates, gathers, and synthesizes. Pick to run a multi-agent workflow.",
  },
};

/**
 * A personality may launch/coordinate when it carries at least one coordinator
 * role. A personality whose roles are entirely focused (researcher, planner,
 * judger, advisor, coder, designer, writer), or that has no roles at all, is a
 * "lifter": it should finish its task, not fan out.
 */
export function personalityCanLaunch(personality: Pick<AgentPersonality, "roles">): boolean {
  return normalizePersonalityRoles(personality.roles).some(
    (role) => PERSONALITY_ROLE_INFO[role].tier === "coordinator",
  );
}

export interface PersonalitySelectionSummary {
  tier: PersonalityRoleTier;
  canLaunch: boolean;
  /** The "why you'd choose me" blurb — each of the personality's roles, joined. */
  guidance: string;
}

/**
 * Build the selection decision-aid for a personality from its roles: the tier
 * (coordinator if any role coordinates), whether it may launch, and a short
 * multi-role "why choose me" blurb. Surfaced by list_personalities so a
 * deciding agent can pick the right teammate from the list alone.
 */
export function summarizePersonalityForSelection(
  personality: Pick<AgentPersonality, "roles">,
): PersonalitySelectionSummary {
  const roles = normalizePersonalityRoles(personality.roles);
  const canLaunch = roles.some((role) => PERSONALITY_ROLE_INFO[role].tier === "coordinator");
  return {
    tier: canLaunch ? "coordinator" : "focused",
    canLaunch,
    guidance: roles.map((role) => PERSONALITY_ROLE_INFO[role].guidance).join(" "),
  };
}

// The conductor's standing directive — the distilled `/epic` method taught to
// the sole orchestrator role at spawn, so orchestration is emergent (the agent
// recognizes team-shaped work and runs it) rather than something a user must
// invoke. Kept here as one exported constant so the wording is testable and
// shared. See projects/agent-orchestration/agent-orchestration.md.
export const ORCHESTRATOR_METHOD_DIRECTIVE =
  "You are the orchestrator — the team's sole conductor. Team-shaped work is yours to run, and you should reach for it naturally, not only when asked. " +
  "First apply the complexity gate: if a task is small and not splittable, just do it — no ceremony. Only orchestrate when the work is large, parallelizable, or benefits from independent perspectives. " +
  "When you do orchestrate: (1) if the shape is unclear, dispatch a researcher to survey and a planner to draft a typed plan; (2) declare that plan as a Run with start_run — phases typed research/plan/implement/design/verify/gate/deliver, fanning out candidates where several angles help and attaching a judger to grade them, looping until enough pass; (3) put a gate before irreversible or costly steps so the user approves; (4) synthesize the passing results into the deliverable. " +
  "Prefer start_run over hand-spawning and tracking agents yourself — the runtime fans out, gathers typed verdicts, and enforces the loop for you. Every phase maps to a teammate's role; if the active team lacks a role a phase needs, say so plainly and stop rather than papering over the gap.";

/**
 * The in-context "role directive" injected into a personality's system prompt at
 * spawn. The orchestrator gets the full conductor method; other coordinators
 * (chatter/artificer/scheduler) get a lighter delegate nudge; focused workers
 * are told to stay on the task someone is waiting on. Roleless spawns get
 * nothing. This is guidance, not a gate — the tools stay available either way.
 */
export function composeRoleFocusDirective(
  roles: readonly string[] | undefined,
): string | undefined {
  const normalized = normalizePersonalityRoles(roles);
  if (normalized.length === 0) {
    return undefined;
  }
  const roleList = normalized.join(", ");
  if (normalized.includes("orchestrator")) {
    return `${ORCHESTRATOR_METHOD_DIRECTIVE} (Your roles: ${roleList}.)`;
  }
  if (normalized.some((role) => PERSONALITY_ROLE_INFO[role].tier === "coordinator")) {
    return `You are a coordinator personality (roles: ${roleList}). You front interactive work and may delegate: use list_personalities to see who else is available, and spawn other agents or hand off to the team's orchestrator whenever delegating gets the work done faster or better.`;
  }
  return `You are a focused worker personality (roles: ${roleList}). Someone is waiting on this specific task — stay on it and finish it. You can still call list_personalities to see the roster, but don't spawn sub-agents or start side workflows unless it is genuinely essential to completing this job.`;
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
export interface PersonalityAvailabilityInput {
  /** Provider snapshot status, or undefined when the provider is absent entirely. */
  providerStatus: "ready" | "loading" | "error" | "unavailable" | undefined;
  providerEnabled: boolean | undefined;
  modelIds: readonly string[] | undefined;
  modeIds: readonly string[] | undefined;
}

export type PersonalityAvailability =
  | { available: true }
  | { available: false; code: PersonalityUnavailableCode; reason: string };

/**
 * Decide whether a personality is usable against a provider's current snapshot.
 * A personality is out of commission the moment any bound setting can't resolve:
 * provider absent/disabled/not-ready, model gone, or an explicit mode missing.
 * The caller grays it out in pickers and hard-fails it in automation.
 */
export function checkPersonalityAvailability(
  personality: Pick<AgentPersonality, "provider" | "model" | "modeId">,
  input: PersonalityAvailabilityInput,
): PersonalityAvailability {
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
  if (!(input.modelIds ?? []).includes(personality.model)) {
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
