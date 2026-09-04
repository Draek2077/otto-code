import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SeedDaemonClient } from "./seed-client";

// Typed view of scripts/perf-corpus.mjs, loaded the same way the boilerplate
// corpus is (helpers/playbook-projects.ts). The seeding logic is shared with the
// dev-daemon script on purpose: a number this soak reports has to describe the
// same corpus a human can open by hand, or it stops being evidence about the app
// they are complaining about.

export interface CorpusScale {
  projects: number;
  workspacesPerProject: number;
  chatsPerWorkspace: number;
  turnsPerChat: number;
  itemsPerTurn: number;
}

export interface CorpusWorkspace {
  workspaceId: string;
  name: string;
  directory: string;
  agentIds: string[];
}

export interface CorpusProject {
  projectId: string;
  label: string;
  rootPath: string;
  workspaces: CorpusWorkspace[];
}

export interface CorpusTotals {
  projects: number;
  workspaces: number;
  chats: number;
  chatsCreated: number;
  chatsAdopted: number;
  turnsDriven: number;
  itemsCreated: number;
  items: number;
}

export interface SeededCorpus {
  projects: CorpusProject[];
  totals: CorpusTotals;
  scale: CorpusScale;
  corpusSeed: number;
  elapsedMs: number;
}

export interface CorpusProgressEvent {
  phase: "project" | "workspace" | "chat" | "turn";
  level?: "warn";
  detail?: string;
  done?: number;
  total?: number;
}

interface PerfCorpusModule {
  DEFAULT_CORPUS_SCALE: CorpusScale;
  SMOKE_CORPUS_SCALE: CorpusScale;
  scaleFromEnv(env: NodeJS.ProcessEnv, base?: CorpusScale): CorpusScale;
  seedPerfCorpus(options: {
    client: SeedDaemonClient;
    projects: Array<{ rootPath: string; label: string }>;
    scale?: CorpusScale;
    concurrency?: number;
    corpusSeed?: number;
    turnTimeoutMs?: number;
    onProgress?: (event: CorpusProgressEvent) => void;
  }): Promise<SeededCorpus>;
}

let cached: PerfCorpusModule | null = null;

export async function loadPerfCorpus(): Promise<PerfCorpusModule> {
  if (cached) {
    return cached;
  }
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const moduleUrl = pathToFileURL(path.join(repoRoot, "scripts/perf-corpus.mjs")).href;
  cached = (await import(moduleUrl)) as PerfCorpusModule;
  return cached;
}
