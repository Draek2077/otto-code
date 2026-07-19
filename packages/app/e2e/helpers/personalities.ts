import { promises as fs } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { connectDaemonClient } from "./daemon-client-loader";

// The daemon's built-in dev provider every personality spec binds to — fully
// deterministic, no network, always available on the E2E daemon (NODE_ENV=development).
export const MOCK_PROVIDER_ID = "mock";
export const MOCK_PROVIDER_LABEL = "Mock Load Test";
export const MOCK_MODEL_ID = "ten-second-stream";
export const MOCK_MODEL_LABEL = "Ten second stream";
export const MOCK_MODE_ID = "load-test";

// ---------------------------------------------------------------------------
// Wire shapes (structural — the daemon client is untyped JS loaded from dist).
// ---------------------------------------------------------------------------

export interface E2EAgentPersonality {
  id: string;
  name: string;
  provider: string;
  model: string;
  modeId?: string;
  effortLevel?: string;
  personalityPrompt?: string;
  respectGlobalAppendPrompt?: boolean;
  roles?: string[];
  spinner?: { glowA: string; glowB: string };
  // Hand-written cue lines so daemon-side flows never route through AI cue
  // generation for spec-owned personalities.
  voiceCues?: { join?: string[]; thinking?: string[]; done?: string[] };
}

export interface E2EAgentTeam {
  id: string;
  name: string;
  avatar?: { color: string };
  teamPrompt?: string;
  memberIds?: string[];
}

interface PersonalitiesConfigSlice {
  agentPersonalities?: { personalities?: E2EAgentPersonality[] };
  agentTeams?: { teams?: E2EAgentTeam[]; activeTeamId?: string | null };
}

export interface PersonalityAgentSnapshot {
  id: string;
  provider: string;
  cwd: string;
  workspaceId?: string;
  model: string | null;
  currentModeId: string | null;
  status: string;
  personalityId?: string;
  personalityName?: string;
  personalitySpinner?: { glowA: string; glowB: string };
}

/**
 * Personality/team-scoped daemon client for E2E specs. Extends the shared
 * seed-client surface with the config get/patch pair (personalities and teams
 * live in daemon config) and the live personality-switch RPC.
 */
export interface PersonalitiesDaemonClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  getDaemonConfig(
    requestId?: string,
  ): Promise<{ requestId: string; config: PersonalitiesConfigSlice }>;
  patchDaemonConfig(
    patch: PersonalitiesConfigSlice,
    requestId?: string,
  ): Promise<{ requestId: string; config: PersonalitiesConfigSlice }>;
  setAgentPersonality(agentId: string, personalityId: string | null): Promise<unknown>;
  createAgent(options: {
    provider: string;
    cwd: string;
    workspaceId?: string;
    title?: string;
    modeId?: string;
    model?: string;
    initialPrompt?: string;
    personality?: string;
  }): Promise<PersonalityAgentSnapshot>;
  fetchAgents(options?: {
    scope?: "active";
  }): Promise<{ entries: Array<{ agent: PersonalityAgentSnapshot }> }>;
  sendAgentMessage(agentId: string, text: string): Promise<void>;
  archiveAgent(agentId: string): Promise<{ archivedAt: string }>;
}

export async function connectPersonalitiesClient(): Promise<PersonalitiesDaemonClient> {
  return connectDaemonClient<PersonalitiesDaemonClient>({
    clientIdPrefix: "app-e2e-personalities",
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let uniqueSeq = 0;

/**
 * Personality names are single-word handles (letters/digits/-/_ only, max 20
 * chars — see sanitizePersonalityName in agent-personalities-section.tsx), so
 * the suffix stays alphanumeric and the prefix must stay short.
 */
export function uniquePersonalityName(prefix: string): string {
  uniqueSeq += 1;
  const name = `${prefix}${Date.now().toString(36)}${uniqueSeq}`;
  if (name.length > 20) {
    throw new Error(`Personality name exceeds the 20-char handle cap: ${name}`);
  }
  return name;
}

export function uniqueId(prefix: string): string {
  uniqueSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${uniqueSeq}_${Math.random().toString(36).slice(2, 8)}`;
}

/** A personality bound to the deterministic mock provider/model. */
export function buildMockPersonality(input: {
  name: string;
  prompt?: string;
  roles?: string[];
  glowA?: string;
  glowB?: string;
}): E2EAgentPersonality {
  return {
    id: uniqueId("personality_e2e"),
    name: input.name,
    provider: MOCK_PROVIDER_ID,
    model: MOCK_MODEL_ID,
    respectGlobalAppendPrompt: true,
    // Default to every role so the personality shows in any role-filtered
    // picker (draft composer = chatter, artifacts = artificer, ...).
    roles: input.roles ?? [
      "chatter",
      "artificer",
      "scheduler",
      "researcher",
      "judger",
      "writer",
      "coder",
      "orchestrator",
    ],
    spinner: { glowA: input.glowA ?? "#22aa66", glowB: input.glowB ?? "#6622aa" },
    ...(input.prompt ? { personalityPrompt: input.prompt } : {}),
    // Pre-filled cues keep every save/spawn path away from AI cue generation.
    voiceCues: { join: ["On it"], thinking: ["Working on it"], done: ["Done"] },
  };
}

export function buildTeam(input: {
  name: string;
  memberIds: string[];
  teamPrompt?: string;
  color?: string;
}): E2EAgentTeam {
  return {
    id: uniqueId("team_e2e"),
    name: input.name,
    avatar: { color: input.color ?? "#4ec4ff" },
    memberIds: [...input.memberIds],
    ...(input.teamPrompt ? { teamPrompt: input.teamPrompt } : {}),
  };
}

// ---------------------------------------------------------------------------
// Daemon config seeding / cleanup (read-modify-write — a patch replaces the
// whole personalities / teams array, mirroring the app's save path).
// ---------------------------------------------------------------------------

export async function seedPersonalities(
  client: PersonalitiesDaemonClient,
  personalities: readonly E2EAgentPersonality[],
): Promise<void> {
  const { config } = await client.getDaemonConfig();
  const current = config.agentPersonalities?.personalities ?? [];
  const additions = personalities.filter(
    (candidate) => !current.some((entry) => entry.id === candidate.id),
  );
  await client.patchDaemonConfig({
    agentPersonalities: { personalities: [...current, ...additions] },
  });
}

export async function removePersonalitiesById(
  client: PersonalitiesDaemonClient,
  ids: readonly string[],
): Promise<void> {
  const { config } = await client.getDaemonConfig();
  const current = config.agentPersonalities?.personalities ?? [];
  const next = current.filter((entry) => !ids.includes(entry.id));
  if (next.length !== current.length) {
    await client.patchDaemonConfig({ agentPersonalities: { personalities: next } });
  }
}

export async function removePersonalitiesByName(
  client: PersonalitiesDaemonClient,
  names: readonly string[],
): Promise<void> {
  const lowered = new Set(names.map((name) => name.trim().toLowerCase()));
  const { config } = await client.getDaemonConfig();
  const current = config.agentPersonalities?.personalities ?? [];
  const next = current.filter((entry) => !lowered.has(entry.name.trim().toLowerCase()));
  if (next.length !== current.length) {
    await client.patchDaemonConfig({ agentPersonalities: { personalities: next } });
  }
}

export async function seedTeams(
  client: PersonalitiesDaemonClient,
  teams: readonly E2EAgentTeam[],
): Promise<void> {
  const { config } = await client.getDaemonConfig();
  const current = config.agentTeams?.teams ?? [];
  const additions = teams.filter(
    (candidate) => !current.some((entry) => entry.id === candidate.id),
  );
  await client.patchDaemonConfig({ agentTeams: { teams: [...current, ...additions] } });
}

export async function removeTeamsById(
  client: PersonalitiesDaemonClient,
  ids: readonly string[],
): Promise<void> {
  const { config } = await client.getDaemonConfig();
  const current = config.agentTeams?.teams ?? [];
  const next = current.filter((entry) => !ids.includes(entry.id));
  const activeTeamId = config.agentTeams?.activeTeamId ?? null;
  const clearActive = activeTeamId !== null && ids.includes(activeTeamId);
  if (next.length !== current.length || clearActive) {
    await client.patchDaemonConfig({
      agentTeams: { teams: next, ...(clearActive ? { activeTeamId: null } : {}) },
    });
  }
}

export async function removeTeamsByName(
  client: PersonalitiesDaemonClient,
  names: readonly string[],
): Promise<void> {
  const lowered = new Set(names.map((name) => name.trim().toLowerCase()));
  const { config } = await client.getDaemonConfig();
  const matching = (config.agentTeams?.teams ?? []).filter((entry) =>
    lowered.has(entry.name.trim().toLowerCase()),
  );
  if (matching.length > 0) {
    await removeTeamsById(
      client,
      matching.map((entry) => entry.id),
    );
  }
}

export async function setActiveTeam(
  client: PersonalitiesDaemonClient,
  teamId: string | null,
): Promise<void> {
  await client.patchDaemonConfig({ agentTeams: { activeTeamId: teamId } });
}

export async function getActiveTeamId(client: PersonalitiesDaemonClient): Promise<string | null> {
  const { config } = await client.getDaemonConfig();
  return config.agentTeams?.activeTeamId ?? null;
}

export async function findPersonalityByName(
  client: PersonalitiesDaemonClient,
  name: string,
): Promise<E2EAgentPersonality | null> {
  const { config } = await client.getDaemonConfig();
  const lowered = name.trim().toLowerCase();
  return (
    (config.agentPersonalities?.personalities ?? []).find(
      (entry) => entry.name.trim().toLowerCase() === lowered,
    ) ?? null
  );
}

export async function findTeamByName(
  client: PersonalitiesDaemonClient,
  name: string,
): Promise<E2EAgentTeam | null> {
  const { config } = await client.getDaemonConfig();
  const lowered = name.trim().toLowerCase();
  return (
    (config.agentTeams?.teams ?? []).find((entry) => entry.name.trim().toLowerCase() === lowered) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Agent polling
// ---------------------------------------------------------------------------

/** Poll active agents until one owned by the workspace shows up. */
export async function waitForAgentInWorkspace(
  client: PersonalitiesDaemonClient,
  workspaceId: string,
  timeoutMs = 60_000,
): Promise<PersonalityAgentSnapshot> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const payload = await client.fetchAgents({ scope: "active" });
    const entry = payload.entries.find((candidate) => candidate.agent.workspaceId === workspaceId);
    if (entry) {
      return entry.agent;
    }
    if (Date.now() > deadline) {
      throw new Error(`No agent appeared in workspace ${workspaceId} within ${timeoutMs}ms`);
    }
    await sleep(250);
  }
}

/** Poll one agent's snapshot until the predicate passes (e.g. personality applied). */
export async function waitForAgentSnapshot(
  client: PersonalitiesDaemonClient,
  agentId: string,
  predicate: (agent: PersonalityAgentSnapshot) => boolean,
  timeoutMs = 30_000,
): Promise<PersonalityAgentSnapshot> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const payload = await client.fetchAgents({ scope: "active" });
    const entry = payload.entries.find((candidate) => candidate.agent.id === agentId);
    if (entry && predicate(entry.agent)) {
      return entry.agent;
    }
    if (Date.now() > deadline) {
      throw new Error(`Agent ${agentId} did not reach the expected snapshot within ${timeoutMs}ms`);
    }
    await sleep(250);
  }
}

// ---------------------------------------------------------------------------
// Persisted agent record (daemon-side truth for prompt composition). The
// daemon persists each agent to $OTTO_HOME/agents/<cwd-dir>/<agent-id>.json
// with the full serializable config, including the composed systemPrompt and
// the frozen personality/team snapshots — the only surface where team-prompt
// stacking is observable end-to-end.
// ---------------------------------------------------------------------------

export interface StoredAgentRecordSlice {
  id?: string;
  config?: {
    systemPrompt?: string;
    personalitySnapshot?: { personalityId?: string; name?: string; systemPrompt?: string };
    teamSnapshot?: { teamId?: string; name?: string; teamPrompt?: string };
  };
}

export async function readStoredAgentRecord(
  agentId: string,
  timeoutMs = 30_000,
): Promise<StoredAgentRecordSlice> {
  const ottoHome = process.env.E2E_OTTO_HOME;
  if (!ottoHome) {
    throw new Error("E2E_OTTO_HOME is not set - globalSetup must run first");
  }
  const agentsDir = path.join(ottoHome, "agents");
  const fileName = `${agentId}.json`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const filePath = await findAgentRecordFile(agentsDir, fileName);
    if (filePath) {
      try {
        return JSON.parse(await fs.readFile(filePath, "utf8")) as StoredAgentRecordSlice;
      } catch {
        // Atomic-write rename may race the read; retry below.
      }
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Agent record ${fileName} not found under ${agentsDir} within ${timeoutMs}ms`,
      );
    }
    await sleep(250);
  }
}

async function findAgentRecordFile(agentsDir: string, fileName: string): Promise<string | null> {
  let entries;
  try {
    entries = await fs.readdir(agentsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === fileName) {
      return path.join(agentsDir, entry.name);
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(agentsDir, entry.name, fileName);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep scanning
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// UI actions — the composer's combined model/personality picker
// ---------------------------------------------------------------------------

/** The composer's combined model + personality picker trigger (desktop web). */
export function modelPickerTrigger(page: Page) {
  return page.getByTestId("combined-model-selector").filter({ visible: true }).first();
}

export async function openModelPersonalityPicker(page: Page): Promise<void> {
  const trigger = modelPickerTrigger(page);
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
}

/**
 * Click a personality row in the open picker. Rows stay disabled (grayed)
 * until the provider snapshot marks the personality available, so wait out
 * the aria-disabled state before clicking; selection closes the popup.
 */
export async function selectPersonalityInPicker(page: Page, personalityId: string): Promise<void> {
  const row = page
    .getByTestId(`personality-row-${personalityId}`)
    .filter({ visible: true })
    .first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
  await row.click();
  await expect(row).not.toBeVisible({ timeout: 10_000 });
}

export async function expectModelTriggerShowsPersonality(page: Page, name: string): Promise<void> {
  await expect(modelPickerTrigger(page)).toContainText(name, { timeout: 30_000 });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
