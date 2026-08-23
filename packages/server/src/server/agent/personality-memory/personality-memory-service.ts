/**
 * The daemon-facing façade over personality memory. Everything above this line -
 * the MCP tools, the spawn injection, the RPCs - talks to this; nothing above it
 * knows about files, scopes or dedup.
 *
 * Its one real job beyond delegation is turning the two things a caller actually
 * has (a personality id, a working directory) into the two things the store and
 * the brief composer need (a name and a project root), and honouring the
 * personality's `memoryEnabled` switch in one place so no caller can forget it.
 */

import type { Logger } from "pino";
import type { AgentProfile } from "@otto-code/protocol/messages";
import { composeMemoryBrief, selectEntriesForProject, type MemoryBrief } from "./memory-brief.js";
import { PersonalityMemoryStore } from "./personality-memory-store.js";
import type {
  PersonalityMemoryEntry,
  PersonalityMemoryScope,
  PersonalityMemorySource,
  RecordLessonResult,
} from "./types.js";

export interface PersonalityMemoryServiceDeps {
  store: PersonalityMemoryStore;
  /** The live roster, for names and the per-personality memory switch. */
  readAgentProfiles: () => readonly AgentProfile[];
  /** git repo root for a cwd, else the cwd. Scopes project lessons. */
  resolveProjectRoot: (cwd: string) => Promise<string>;
  logger: Logger;
}

/**
 * `memoryEnabled` absent means ON. A personality with no lessons costs nothing -
 * the brief is empty and injects nothing - so defaulting to off would only mean
 * the feature never starts working for anyone who did not go looking for a
 * switch. The switch exists to stop a personality accruing, not to start it.
 */
export function isPersonalityMemoryEnabled(personality: AgentProfile | undefined): boolean {
  if (!personality) return false;
  const value = (personality as { memoryEnabled?: unknown }).memoryEnabled;
  return value !== false;
}

export interface PersonalityMemoryView {
  personalityId: string;
  personalityName: string;
  enabled: boolean;
  /** Every stored entry, not just this project's - the Memory tab shows all. */
  entries: PersonalityMemoryEntry[];
  /** The exact text that would be injected for `projectRoot`. */
  brief: MemoryBrief;
}

export class PersonalityMemoryService {
  private readonly store: PersonalityMemoryStore;

  constructor(private readonly deps: PersonalityMemoryServiceDeps) {
    this.store = deps.store;
  }

  private findPersonality(personalityId: string): AgentProfile | undefined {
    return this.deps.readAgentProfiles().find((entry) => entry.id === personalityId);
  }

  /**
   * The brief to inject for an agent spawned from `personalityId` in `cwd`, or
   * null when there is nothing to inject. Null covers every "no memory" case -
   * unknown personality, switch off, no lessons yet - so the spawn path has one
   * branch instead of four.
   *
   * Never throws: a memory read failing must not stop an agent from spawning.
   */
  async resolveBriefForSpawn(params: {
    personalityId: string;
    personalityName: string;
    cwd: string | undefined;
  }): Promise<string | null> {
    try {
      const personality = this.findPersonality(params.personalityId);
      // An unknown id is normal, not an error: an agent keeps its spawn snapshot
      // after the personality is deleted from the roster, and it should keep the
      // lessons that identity accrued too.
      if (personality && !isPersonalityMemoryEnabled(personality)) return null;

      const entries = await this.store.list(params.personalityId);
      if (entries.length === 0) return null;

      const projectRoot = params.cwd ? await this.safeProjectRoot(params.cwd) : undefined;
      const brief = composeMemoryBrief({
        personalityName: personality?.name ?? params.personalityName,
        entries: selectEntriesForProject(entries, projectRoot),
      });
      return brief.text.length > 0 ? brief.text : null;
    } catch (error) {
      this.deps.logger.warn(
        { err: error, personalityId: params.personalityId },
        "Failed to resolve personality memory brief; spawning without it",
      );
      return null;
    }
  }

  /** Everything the Memory tab and the visibility requirement need. */
  async view(params: {
    personalityId: string;
    projectRoot?: string;
  }): Promise<PersonalityMemoryView> {
    const personality = this.findPersonality(params.personalityId);
    const entries = await this.store.list(params.personalityId);
    const brief = composeMemoryBrief({
      personalityName: personality?.name ?? "this personality",
      entries: selectEntriesForProject(entries, params.projectRoot),
    });
    return {
      personalityId: params.personalityId,
      personalityName: personality?.name ?? params.personalityId,
      enabled: isPersonalityMemoryEnabled(personality),
      entries,
      brief,
    };
  }

  /**
   * Record a lesson for the personality behind a running agent. `scope` comes
   * from the agent as a plain intent ("project" or "everywhere"); resolving that
   * to an absolute root is this layer's job, never the agent's.
   */
  async record(params: {
    personalityId: string;
    lesson: string;
    scope: PersonalityMemoryScope;
    cwd?: string;
    source?: PersonalityMemorySource;
  }): Promise<RecordLessonResult> {
    const projectRoot =
      params.scope === "project" && params.cwd ? await this.safeProjectRoot(params.cwd) : undefined;
    return this.store.record({
      personalityId: params.personalityId,
      lesson: params.lesson,
      scope: projectRoot ? "project" : "global",
      ...(projectRoot ? { projectRoot } : {}),
      source: params.source ?? "agent",
    });
  }

  async list(personalityId: string): Promise<PersonalityMemoryEntry[]> {
    return this.store.list(personalityId);
  }

  /**
   * `cwd` is the same convenience `record` offers: callers that have a working
   * directory but no root hand it over and let this layer resolve it. It matters
   * on a scope change to "project" - an entry moved to project scope with no
   * root matches no project's brief, so it would be listed and never injected.
   */
  async revise(params: {
    personalityId: string;
    entryId: string;
    text?: string;
    scope?: PersonalityMemoryScope;
    projectRoot?: string;
    cwd?: string;
    drop?: boolean;
  }): Promise<boolean> {
    const { cwd, ...rest } = params;
    const projectRoot =
      params.projectRoot ?? (cwd && !params.drop ? await this.safeProjectRoot(cwd) : undefined);
    return this.store.revise({ ...rest, ...(projectRoot ? { projectRoot } : {}) });
  }

  async addUserEntry(params: {
    personalityId: string;
    text: string;
    scope: PersonalityMemoryScope;
    projectRoot?: string;
  }): Promise<RecordLessonResult> {
    return this.store.add({
      personalityId: params.personalityId,
      lesson: params.text,
      scope: params.scope,
      ...(params.projectRoot ? { projectRoot: params.projectRoot } : {}),
      source: "user",
    });
  }

  async counts(): Promise<Record<string, number>> {
    return this.store.counts();
  }

  async transfer(params: {
    fromPersonalityId: string;
    toPersonalityId: string;
  }): Promise<{ transferred: number; merged: number }> {
    const from = this.findPersonality(params.fromPersonalityId);
    return this.store.transfer({
      ...params,
      ...(from?.name ? { fromPersonalityName: from.name } : {}),
    });
  }

  async clear(personalityId: string): Promise<void> {
    await this.store.clear(personalityId);
  }

  private async safeProjectRoot(cwd: string): Promise<string> {
    try {
      return await this.deps.resolveProjectRoot(cwd);
    } catch {
      // A non-git directory is ordinary, not an error - the cwd IS the project.
      return cwd;
    }
  }
}
