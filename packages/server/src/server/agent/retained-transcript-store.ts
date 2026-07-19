import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import type { AgentSnapshotPayload } from "../messages.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { writeJsonFileAtomic } from "../atomic-file.js";

// What produced a retained transcript, so it can be cascade-deleted when its
// owner is deleted. Schedule and artifact generation agents are internal +
// ephemeral (never written to agent storage, closed after the run), so their
// chat would otherwise be lost. We snapshot it here, keyed by the generation
// agent id, and delete it with the owning artifact/schedule.
export interface RetainedTranscriptOwner {
  kind: "artifact" | "schedule";
  id: string;
}

export interface RetainedTranscriptRecord {
  version: 1;
  agentId: string;
  owner: RetainedTranscriptOwner;
  capturedAt: string;
  // The generation agent's final snapshot (status/provider/model/cwd/title/…),
  // served back through the normal fetch_agent path so the read-only viewer
  // renders it exactly like any other chat.
  payload: AgentSnapshotPayload;
  // The full projected-source timeline rows captured at run end. Served through
  // fetch_agent_timeline by seeding the in-memory timeline store, so projection
  // and rendering are identical to a live agent.
  rows: AgentTimelineRow[];
  // Whether the run produced anything beyond its seed prompt (any assistant
  // message / tool activity). Drives "reveal the failed run's workspace only if
  // there's content" — a run that failed before doing anything leaves no empty
  // workspace behind. See docs/safe-unattended.md.
  hasContent: boolean;
}

// Agent ids are provider/uuid strings; anything that reaches a filesystem path
// must be a single safe segment so a crafted id can't traverse out of the store
// dir. Mirrors ArtifactStore.assertValidArtifactId.
const AGENT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

function assertValidAgentId(agentId: string): void {
  if (!AGENT_ID_PATTERN.test(agentId)) {
    throw new Error(`Invalid retained-transcript agent id: ${JSON.stringify(agentId)}`);
  }
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * File-backed store of retained generation-agent transcripts, one JSON file per
 * agent id under `$OTTO_HOME/retained-transcripts`. Owner metadata on each
 * record makes cascade-delete a scan-and-match, so deleting an artifact or
 * schedule removes every transcript it produced. See docs/safe-unattended.md.
 */
export class RetainedTranscriptStore {
  private readonly baseDir: string;
  private readonly logger: Logger;
  // In-memory cache so the hot read path (viewer opens a transcript) doesn't hit
  // disk every time. Populated lazily on get() and on save().
  private readonly cache = new Map<string, RetainedTranscriptRecord | null>();

  constructor(options: { ottoHome: string; logger: Logger }) {
    this.baseDir = join(options.ottoHome, "retained-transcripts");
    this.logger = options.logger.child({ module: "retained-transcript-store" });
  }

  private recordPath(agentId: string): string {
    assertValidAgentId(agentId);
    return join(this.baseDir, `${agentId}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  async save(record: RetainedTranscriptRecord): Promise<void> {
    await this.ensureDir();
    await writeJsonFileAtomic(this.recordPath(record.agentId), record);
    this.cache.set(record.agentId, record);
  }

  async get(agentId: string): Promise<RetainedTranscriptRecord | null> {
    if (!AGENT_ID_PATTERN.test(agentId)) {
      return null;
    }
    const cached = this.cache.get(agentId);
    if (cached !== undefined) {
      return cached;
    }
    const record = await this.readFromDisk(agentId);
    this.cache.set(agentId, record);
    return record;
  }

  has(agentId: string): boolean {
    return this.cache.get(agentId) != null;
  }

  private async readFromDisk(agentId: string): Promise<RetainedTranscriptRecord | null> {
    try {
      const content = await readFile(this.recordPath(agentId), "utf-8");
      return JSON.parse(content) as RetainedTranscriptRecord;
    } catch (error) {
      if (isEnoent(error)) {
        return null;
      }
      this.logger.warn({ err: error, agentId }, "Failed to read retained transcript");
      return null;
    }
  }

  async delete(agentId: string): Promise<void> {
    if (!AGENT_ID_PATTERN.test(agentId)) {
      return;
    }
    await this.ensureDir();
    await rm(this.recordPath(agentId), { force: true });
    this.cache.delete(agentId);
  }

  // Remove every transcript produced by one owner. Called when an artifact or
  // schedule is deleted so its generation chats don't outlive it.
  async deleteForOwner(owner: RetainedTranscriptOwner): Promise<number> {
    await this.ensureDir();
    let entries: string[];
    try {
      entries = (await readdir(this.baseDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name);
    } catch (error) {
      if (isEnoent(error)) {
        return 0;
      }
      throw error;
    }
    let removed = 0;
    await Promise.all(
      entries.map(async (name) => {
        const agentId = name.slice(0, -".json".length);
        const record = await this.readFromDisk(agentId);
        if (record && record.owner.kind === owner.kind && record.owner.id === owner.id) {
          await this.delete(agentId);
          removed += 1;
        }
      }),
    );
    return removed;
  }
}
