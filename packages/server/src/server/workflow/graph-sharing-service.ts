import {
  GRAPH_DOCUMENT_FORMAT,
  GRAPH_DOCUMENT_FORMAT_VERSION,
  type OrchestrationGraph,
  type WorkflowGraphExport,
  type WorkflowGraphImportResult,
  validateGraphDocument,
  validateOrchestrationGraph,
} from "@otto-code/protocol/workflow";

import { graphHash, hasExpectedWorkflowStorage } from "./graph-identity.js";
import { GraphStore } from "./graph-store.js";
import {
  type WorkflowLibraryRecordKind,
  type WorkflowLibrarySource,
  type WorkflowTransferMode,
  type WorkflowTransferReceipt,
  WorkflowLibraryService,
} from "./workflow-library-service.js";
import type { WorkflowStorageLocation } from "./workflow-store-registry.js";

interface WorkflowStoreAccess {
  resolveForCwd(cwd: string): Promise<WorkflowStorageLocation>;
  provenanceFor(location: WorkflowStorageLocation): OrchestrationGraph["workflowStorage"];
}

/**
 * The daemon-owned Graph share boundary. A review response has no write side
 * effect; only the explicit confirmed request may create a project-store copy.
 */
export class GraphSharingService {
  constructor(
    private readonly legacyStore: GraphStore,
    private readonly stores: WorkflowStoreAccess,
    private readonly createStore: (directory: string) => GraphStore = (directory) =>
      new GraphStore(directory),
    private readonly library: WorkflowLibraryService | null = null,
  ) {}

  /**
   * Lists only definitions persisted for the requested project. This is
   * intentionally distinct from the legacy host library used for exports:
   * callers selecting a durable Workflow target must never be offered a
   * starter or host-global Graph that cannot be resolved at fire time.
   */
  async listProjectGraphs(cwd: string): Promise<OrchestrationGraph[]> {
    if (this.library) return this.library.listProjectGraphs(cwd);
    const location = await this.stores.resolveForCwd(cwd);
    const expected = this.stores.provenanceFor(location);
    if (!expected) return [];
    const store = this.createStore(location.definitionsDirectory);
    const graphs = await store.list();
    return graphs.filter(
      (graph) =>
        !graph.builtIn &&
        hasExpectedWorkflowStorage(graph.workflowStorage, expected, location.legacyStoreKeys),
    );
  }

  async saveProjectGraph(cwd: string, graph: OrchestrationGraph): Promise<OrchestrationGraph> {
    if (!this.library) {
      throw new Error("Project Workflow storage is not available on this daemon.");
    }
    return this.library.saveProjectGraph(cwd, graph);
  }

  async listProjectTemplates(cwd: string) {
    if (!this.library) {
      throw new Error("Project Workflow storage is not available on this daemon.");
    }
    return this.library.listProjectTemplates(cwd);
  }

  async saveProjectTemplate(
    cwd: string,
    template: import("@otto-code/protocol/workflow").PromptTemplate,
  ) {
    if (!this.library) {
      throw new Error("Project Workflow storage is not available on this daemon.");
    }
    return this.library.saveProjectTemplate(cwd, template);
  }

  async projectGraphStore(cwd: string): Promise<GraphStore> {
    if (!this.library) throw new Error("Project Workflow storage is not available on this daemon.");
    return this.library.projectGraphStore(cwd);
  }

  async projectTemplateStore(
    cwd: string,
  ): Promise<import("./prompt-template-store.js").PromptTemplateStore> {
    if (!this.library) throw new Error("Project Workflow storage is not available on this daemon.");
    return this.library.projectTemplateStore(cwd);
  }

  async transferProjectRecord(input: {
    cwd: string;
    recordKind: WorkflowLibraryRecordKind;
    recordId: string;
    source: WorkflowLibrarySource;
    destination: "repository" | "host";
    mode: WorkflowTransferMode;
  }): Promise<WorkflowTransferReceipt> {
    if (!this.library) throw new Error("Project Workflow storage is not available on this daemon.");
    return this.library.transfer(input);
  }

  async exportGraph(graphId: string): Promise<WorkflowGraphExport> {
    const graph = await this.legacyStore.get(graphId);
    if (!graph) throw new Error(`Graph ${graphId} not found`);
    const portable = this.portableGraph(graph);
    return {
      schemaVersion: 1,
      graph: portable,
      source: {
        storeKey: "workflows:legacy-host-library",
        location: "host",
        source: "legacy-host-library",
      },
      exportedAt: new Date().toISOString(),
      contentHash: graphHash(portable),
    };
  }

  async importGraph(input: {
    cwd: string;
    exported: WorkflowGraphExport;
    confirmed: boolean;
  }): Promise<WorkflowGraphImportResult> {
    const destination = await this.stores.resolveForCwd(input.cwd);
    const location = toShareLocation(destination);
    const verification = verifyExport(input.exported);
    if (verification) {
      return {
        status: "failed",
        source: input.exported.source,
        destination: location,
        remediation: verification,
      };
    }
    if (!input.confirmed) {
      return {
        status: "review_required",
        graph: input.exported.graph,
        source: input.exported.source,
        destination: location,
        contentHash: input.exported.contentHash,
        remediation:
          "Review the Graph's EJS templates, query tools, nodes, and authority, then rerun with --confirm to copy it. It cannot run before confirmation.",
      };
    }
    const destinationStore = this.createStore(destination.definitionsDirectory);
    if (await destinationStore.get(input.exported.graph.id)) {
      return {
        status: "failed",
        source: input.exported.source,
        destination: location,
        remediation: `Destination already contains Graph ${input.exported.graph.id}. Rename the Graph before import or export the destination copy for review.`,
      };
    }
    const graph = {
      ...input.exported.graph,
      workflowStorage: this.stores.provenanceFor(destination),
      sharedFrom: {
        storeKey: input.exported.source.storeKey,
        exportedAt: input.exported.exportedAt,
        contentHash: input.exported.contentHash,
      },
    } satisfies OrchestrationGraph;
    try {
      await destinationStore.save(graph);
      const persisted = await destinationStore.get(graph.id);
      if (!persisted || graphHash(this.portableGraph(persisted)) !== input.exported.contentHash) {
        throw new Error("Destination verification did not match the imported Graph");
      }
      return {
        status: "imported",
        graph: persisted,
        source: input.exported.source,
        destination: location,
        contentHash: input.exported.contentHash,
        remediation:
          "Graph copied and verified. Review remains recorded in its import provenance; start it only when you are ready to run the declared authority.",
      };
    } catch (error) {
      return {
        status: "failed",
        source: input.exported.source,
        destination: location,
        remediation: `The source was not changed. Retry the confirmed import after fixing destination storage: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private portableGraph(graph: OrchestrationGraph): OrchestrationGraph {
    const {
      workflowStorage: _storage,
      sharedFrom: _sharedFrom,
      builtIn: _builtIn,
      ...portable
    } = graph;
    return {
      ...portable,
      format: GRAPH_DOCUMENT_FORMAT,
      formatVersion: GRAPH_DOCUMENT_FORMAT_VERSION,
    };
  }
}

function verifyExport(exported: WorkflowGraphExport): string | null {
  if (exported.schemaVersion !== 1)
    return "This Graph export package version is unsupported. Update Otto or obtain a version 1 export.";
  if (graphHash(exported.graph) !== exported.contentHash)
    return "The Graph export content hash does not match. Re-export the source Graph before importing.";
  const documentErrors = validateGraphDocument(exported.graph).filter(
    (entry) => entry.severity === "error",
  );
  if (documentErrors.length > 0)
    return documentErrors.map((entry) => `${entry.message} ${entry.recovery}`).join(" ");
  const structuralErrors = validateOrchestrationGraph(exported.graph);
  return structuralErrors.length > 0
    ? `Graph is not structurally valid: ${structuralErrors.join(" ")}`
    : null;
}

function toShareLocation(location: WorkflowStorageLocation): WorkflowGraphExport["source"] {
  return {
    storeKey: location.storeKey,
    location: location.location,
    ...(location.hostName ? { hostName: location.hostName } : {}),
    source: "project-store",
  };
}
