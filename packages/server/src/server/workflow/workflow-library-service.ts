import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type {
  OrchestrationGraph,
  PromptTemplate,
  Run,
  WorkflowStorageProvenance,
} from "@otto-code/protocol/workflow";

import { writeJsonFileAtomic } from "../atomic-file.js";
import { GraphStore } from "./graph-store.js";
import { PromptTemplateStore } from "./prompt-template-store.js";
import { RunStore } from "./workflow-run-file-store.js";
import type { WorkflowStorageLocation } from "./workflow-store-registry.js";

export type WorkflowLibraryRecordKind = "graph" | "template" | "run";
export type WorkflowLibrarySource = "legacy-host-library" | "repository" | "host";
export type WorkflowTransferMode = "copy" | "move";

export interface WorkflowTransferReceipt {
  schemaVersion: 1;
  receiptId: string;
  recordKind: WorkflowLibraryRecordKind;
  recordId: string;
  mode: WorkflowTransferMode;
  source: { source: WorkflowLibrarySource; storeKey: string };
  destination: { location: "repository" | "host"; storeKey: string };
  contentHash: string;
  status: "prepared" | "verified" | "moved" | "source-retained" | "failed";
  createdAt: string;
  updatedAt: string;
  recovery?: string;
}

interface WorkflowStoreAccess {
  resolveForCwd(cwd: string): Promise<WorkflowStorageLocation>;
  discoverForProjectRoot(projectRoot: string): Promise<{
    selected: WorkflowStorageLocation;
    alternate: WorkflowStorageLocation;
  }>;
  provenanceFor(location: WorkflowStorageLocation): WorkflowStorageProvenance;
}

type WorkflowRecord = OrchestrationGraph | PromptTemplate | Run;

/**
 * Project-owned Workflow definitions, templates, and records. This is kept
 * intentionally separate from the Knowledge, Artifacts, and Schedules stores:
 * it receives only the category registry and exposes stable record ids plus
 * project scope, never daemon-private directories to callers.
 */
export class WorkflowLibraryService {
  constructor(
    private readonly stores: WorkflowStoreAccess,
    private readonly legacy: {
      graphsDirectory: string;
      templatesDirectory: string;
      runsDirectory: string;
    },
    private readonly createGraphStore: (directory: string) => GraphStore = (directory) =>
      new GraphStore(directory),
    private readonly createTemplateStore: (directory: string) => PromptTemplateStore = (
      directory,
    ) => new PromptTemplateStore(directory),
    private readonly createRunStore: (directory: string) => RunStore = (directory) =>
      new RunStore(directory),
  ) {}

  async listProjectGraphs(cwd: string): Promise<OrchestrationGraph[]> {
    const location = await this.stores.resolveForCwd(cwd);
    const expected = this.stores.provenanceFor(location);
    return (await this.graphStore(location).list()).filter(
      (graph) => graph.workflowStorage?.storeKey === expected.storeKey && !graph.builtIn,
    );
  }

  async projectGraphStore(cwd: string): Promise<GraphStore> {
    return this.graphStore(await this.stores.resolveForCwd(cwd));
  }

  async saveProjectGraph(cwd: string, input: OrchestrationGraph): Promise<OrchestrationGraph> {
    const location = await this.stores.resolveForCwd(cwd);
    const { builtIn: _builtIn, ...rest } = input;
    const now = new Date().toISOString();
    const graph: OrchestrationGraph = {
      ...rest,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
      workflowStorage: this.stores.provenanceFor(location),
    };
    await this.graphStore(location).save(graph);
    return graph;
  }

  async listProjectTemplates(cwd: string): Promise<PromptTemplate[]> {
    const location = await this.stores.resolveForCwd(cwd);
    const expected = this.stores.provenanceFor(location);
    return (await this.templateStore(location).list()).filter(
      (template) => template.workflowStorage?.storeKey === expected.storeKey && !template.builtIn,
    );
  }

  async projectTemplateStore(cwd: string): Promise<PromptTemplateStore> {
    return this.templateStore(await this.stores.resolveForCwd(cwd));
  }

  async saveProjectTemplate(cwd: string, input: PromptTemplate): Promise<PromptTemplate> {
    const location = await this.stores.resolveForCwd(cwd);
    const { builtIn: _builtIn, ...rest } = input;
    const now = new Date().toISOString();
    const template: PromptTemplate = {
      ...rest,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
      workflowStorage: this.stores.provenanceFor(location),
    };
    await this.templateStore(location).save(template);
    return template;
  }

  /** Explicitly copy or move one stable record within the current project scope. */
  async transfer(input: {
    cwd: string;
    recordKind: WorkflowLibraryRecordKind;
    recordId: string;
    source: WorkflowLibrarySource;
    destination: "repository" | "host";
    mode: WorkflowTransferMode;
  }): Promise<WorkflowTransferReceipt> {
    const destination = await this.locationFor(input.cwd, input.destination);
    const source = await this.sourceFor(input.cwd, input.source);
    if (source.storeKey === destination.storeKey) {
      throw new Error("The Workflow record is already in the selected destination store.");
    }
    const sourceRecord = await this.get(source, input.recordKind, input.recordId);
    if (!sourceRecord) {
      throw new Error(
        `Workflow ${input.recordKind} "${input.recordId}" was not found in its stated source.`,
      );
    }
    if (await this.get(destination, input.recordKind, input.recordId)) {
      throw new Error(
        `Destination already contains Workflow ${input.recordKind} "${input.recordId}". Neither copy was changed.`,
      );
    }

    const receiptDirectory = path.join(destination.baseDirectory, "transfer-receipts");
    const now = new Date().toISOString();
    const receiptPath = path.join(receiptDirectory, `${randomUUID()}.json`);
    const transferred = this.withProvenance(sourceRecord, destination);
    const contentHash = recordHash(transferred);
    let receipt: WorkflowTransferReceipt = {
      schemaVersion: 1,
      receiptId: path.basename(receiptPath, ".json"),
      recordKind: input.recordKind,
      recordId: input.recordId,
      mode: input.mode,
      source: { source: input.source, storeKey: source.storeKey },
      destination: { location: destination.location, storeKey: destination.storeKey },
      contentHash,
      status: "prepared",
      createdAt: now,
      updatedAt: now,
    };
    await this.writeReceipt(receiptDirectory, receiptPath, receipt);

    try {
      await this.save(destination, input.recordKind, transferred);
      const verified = await this.get(destination, input.recordKind, input.recordId);
      if (!verified || recordHash(verified) !== contentHash) {
        throw new Error("Destination verification did not match the transferred Workflow record.");
      }
      receipt = { ...receipt, status: "verified", updatedAt: new Date().toISOString() };
      await this.writeReceipt(receiptDirectory, receiptPath, receipt);
    } catch (error) {
      receipt = {
        ...receipt,
        status: "failed",
        updatedAt: new Date().toISOString(),
        recovery: `Source was retained. ${error instanceof Error ? error.message : String(error)}`,
      };
      await this.writeReceipt(receiptDirectory, receiptPath, receipt);
      throw error;
    }

    if (input.mode === "copy") return receipt;
    try {
      await this.delete(source, input.recordKind, input.recordId);
      return this.writeReceipt(receiptDirectory, receiptPath, {
        ...receipt,
        status: "moved",
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return this.writeReceipt(receiptDirectory, receiptPath, {
        ...receipt,
        status: "source-retained",
        updatedAt: new Date().toISOString(),
        recovery: `Destination is verified; source was retained for recovery because deletion failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /**
   * Finds interrupted transfers without guessing ownership or deleting data.
   * A prepared receipt is durable proof that recovery needs user attention.
   */
  async listTransferReceipts(cwd: string): Promise<WorkflowTransferReceipt[]> {
    const location = await this.stores.resolveForCwd(cwd);
    const directory = path.join(location.baseDirectory, "transfer-receipts");
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const receipts = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map(async (entry) => {
            try {
              const parsed = JSON.parse(await readFile(path.join(directory, entry.name), "utf-8"));
              return parsed as WorkflowTransferReceipt;
            } catch (error) {
              return {
                schemaVersion: 1,
                receiptId: path.basename(entry.name, ".json"),
                recordKind: "graph",
                recordId: "unknown",
                mode: "copy",
                source: { source: "legacy-host-library", storeKey: "workflows:unknown" },
                destination: { location: location.location, storeKey: location.storeKey },
                contentHash: "0".repeat(64),
                status: "failed",
                createdAt: "",
                updatedAt: "",
                recovery: `Transfer receipt is corrupt and was not acted on: ${error instanceof Error ? error.message : String(error)}`,
              } satisfies WorkflowTransferReceipt;
            }
          }),
      );
      return receipts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async sourceFor(
    cwd: string,
    source: WorkflowLibrarySource,
  ): Promise<WorkflowStorageLocation> {
    if (source === "legacy-host-library") {
      return {
        ...(await this.stores.resolveForCwd(cwd)),
        baseDirectory: "",
        definitionsDirectory: this.legacy.graphsDirectory,
        templatesDirectory: this.legacy.templatesDirectory,
        runsDirectory: this.legacy.runsDirectory,
        storeKey: "workflows:legacy-host-library",
      };
    }
    return this.locationFor(cwd, source);
  }

  private async locationFor(
    cwd: string,
    requested: "repository" | "host",
  ): Promise<WorkflowStorageLocation> {
    const selected = await this.stores.resolveForCwd(cwd);
    if (selected.location === requested) return selected;
    const stores = await this.stores.discoverForProjectRoot(selected.projectRoot);
    return stores.alternate.location === requested ? stores.alternate : stores.selected;
  }

  private graphStore(location: WorkflowStorageLocation): GraphStore {
    return this.createGraphStore(location.definitionsDirectory);
  }

  private templateStore(location: WorkflowStorageLocation): PromptTemplateStore {
    return this.createTemplateStore(location.templatesDirectory);
  }

  private runStore(location: WorkflowStorageLocation): RunStore {
    return this.createRunStore(location.runsDirectory);
  }

  private get(
    location: WorkflowStorageLocation,
    kind: WorkflowLibraryRecordKind,
    id: string,
  ): Promise<WorkflowRecord | null> {
    if (kind === "graph") return this.graphStore(location).get(id);
    if (kind === "template") return this.templateStore(location).get(id);
    return this.runStore(location).get(id);
  }

  private save(
    location: WorkflowStorageLocation,
    kind: WorkflowLibraryRecordKind,
    record: WorkflowRecord,
  ): Promise<void> {
    if (kind === "graph") return this.graphStore(location).save(record as OrchestrationGraph);
    if (kind === "template") return this.templateStore(location).save(record as PromptTemplate);
    return this.runStore(location).save(record as Run);
  }

  private delete(
    location: WorkflowStorageLocation,
    kind: WorkflowLibraryRecordKind,
    id: string,
  ): Promise<void> {
    if (kind === "graph") return this.graphStore(location).delete(id);
    if (kind === "template") return this.templateStore(location).delete(id);
    return this.runStore(location).delete(id);
  }

  private withProvenance(
    record: WorkflowRecord,
    location: WorkflowStorageLocation,
  ): WorkflowRecord {
    return { ...record, workflowStorage: this.stores.provenanceFor(location) };
  }

  private async writeReceipt(
    directory: string,
    receiptPath: string,
    receipt: WorkflowTransferReceipt,
  ): Promise<WorkflowTransferReceipt> {
    await mkdir(directory, { recursive: true });
    await writeJsonFileAtomic(receiptPath, receipt);
    return receipt;
  }
}

function recordHash(record: WorkflowRecord): string {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(record)))
    .digest("hex");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}
