import path from "node:path";
import { readdir } from "node:fs/promises";
import {
  AiWorkflowDefinition,
  OrchestrationGraphSchema,
  PromptTemplateSchema,
  WorkflowRunRecord,
  normalizeWorkflowRunRecord,
  type WorkflowDocument,
  type WorkflowEntry,
  type WorkflowRef,
  type WorkflowKind,
  type WorkflowScope,
  type WorkflowSummary,
  type WorkflowPage,
  type WorkflowStorageProvenance,
} from "@getpaseo/plugin/otto/workflows";
import { normalizePathForIdentity } from "../../../utils/path.js";
import { WorkflowStores, type WorkflowStore } from "./stores.js";
import {
  WorkflowError,
  assertWorkflowId,
  readWorkflowFile,
  publishWorkflowFile,
  retireWorkflowFile,
  workflowDigest,
  workflowDirectory,
  workflowExclusive,
} from "./files.js";

export interface WorkflowLibraryPorts {
  stores: WorkflowStores;
  /** Legacy worktree identity is resolved by the existing registry, never guessed from a path prefix. */
  legacyWorkspaceProject?(workspaceId: string): Promise<string | null>;
  changed?(scope: WorkflowScope): void;
}
export interface LocatedWorkflow {
  entry: WorkflowEntry;
  store: WorkflowStore;
  bytes: string;
}
export type WorkflowLibraryKind = WorkflowKind | "definition";
export function parseWorkflowDocument(kind: WorkflowKind, value: unknown): WorkflowDocument {
  switch (kind) {
    case "graph":
      return { kind, value: OrchestrationGraphSchema.parse(value) };
    case "ai":
      return { kind, value: AiWorkflowDefinition.parse(value) };
    case "template":
      return { kind, value: PromptTemplateSchema.parse(value) };
    case "run":
      return { kind, value: normalizeWorkflowRunRecord(WorkflowRunRecord.parse(value)) };
  }
}
function identifyDefinition(value: unknown): "ai" | "graph" {
  return value !== null &&
    typeof value === "object" &&
    "format" in value &&
    value.format === "otto.workflow.ai"
    ? "ai"
    : "graph";
}
export function workflowSummary(entry: WorkflowEntry): WorkflowSummary {
  const { document, ref, revision } = entry;
  const title =
    document.kind === "graph" || document.kind === "template"
      ? document.value.name
      : document.value.title;
  const run = document.kind === "run" ? document.value : null;
  return {
    ref,
    revision,
    title: title.slice(0, 240),
    description: (document.value.description ?? "").slice(0, 1000),
    status: run?.status ?? null,
    createdAt: (document.value.createdAt ?? "").slice(0, 80),
    updatedAt: (document.value.updatedAt ?? "").slice(0, 80),
    workspaceId: run?.workspaceId ?? null,
    conductorAgentId: run?.conductorAgentId ?? null,
    error: run?.error?.slice(0, 2000) ?? null,
    agentCount: run?.agentCount ?? 0,
  };
}
export function workflowProvenance(store: WorkflowStore): WorkflowStorageProvenance {
  return {
    schemaVersion: 1,
    projectRoot: store.project.rootPath,
    projectId: store.scope.projectId,
    location: store.location === "repository" ? "repository" : "host",
    storeKey: store.storeKey,
    ...(store.location !== "repository" ? { hostId: store.scope.hostId } : {}),
    source: store.location === "legacy" ? "legacy-host-library" : "project-store",
  };
}
function documentWithOrigin(document: WorkflowDocument, store: WorkflowStore): WorkflowDocument {
  return parseWorkflowDocument(document.kind, {
    ...document.value,
    workflowStorage: workflowProvenance(store),
  });
}
export function assertDocumentBudget(document: WorkflowDocument): void {
  assertWorkflowId(document.value.id);
  if (document.kind !== "graph") return;
  if (document.value.nodes.length > 64 || (document.value.edges?.length ?? 0) > 128)
    throw new WorkflowError("invalid", "A Workflow Graph supports at most 64 nodes and 128 edges.");
  const expressions = [
    ...document.value.nodes.map((n) => n.check?.expression ?? ""),
    ...(document.value.edges ?? []).map((e) => e.when?.expression ?? ""),
  ];
  if (expressions.some((e) => e.length > 4096) || expressions.join("").length > 64000)
    throw new WorkflowError(
      "invalid",
      "Workflow Graph expressions exceed their validation budget.",
    );
}

/** One bounded library for UI/CLI/MCP. Construction/read discovery does not allocate a store or start an agent. */
export class WorkflowLibrary {
  constructor(readonly ports: WorkflowLibraryPorts) {}
  private async belongs(document: WorkflowDocument, store: WorkflowStore): Promise<boolean> {
    const value = document.value;
    const provenance = value.workflowStorage;
    if (provenance && typeof provenance === "object") {
      if ("projectId" in provenance && typeof provenance.projectId === "string")
        if (provenance.projectId === store.scope.projectId) return true;
        // COMPAT(otto09WorkflowProjectIdentity): added v0.10.0; remove after 2027-05-05 once retained records are explicitly copied. Canonical root proof survives a registry ID rebuild; names and directory slugs are never sufficient.
        else
          return (
            "projectRoot" in provenance &&
            typeof provenance.projectRoot === "string" &&
            normalizePathForIdentity(provenance.projectRoot) ===
              normalizePathForIdentity(store.project.rootPath)
          );
      if ("projectRoot" in provenance && typeof provenance.projectRoot === "string")
        return (
          normalizePathForIdentity(provenance.projectRoot) ===
          normalizePathForIdentity(store.project.rootPath)
        );
    }
    if (document.kind !== "run") return true;
    if (document.value.projectId) return document.value.projectId === store.scope.projectId;
    if (store.location !== "legacy") return true;
    if (document.value.workspaceId && this.ports.legacyWorkspaceProject)
      return (
        (await this.ports.legacyWorkspaceProject(document.value.workspaceId)) ===
        store.scope.projectId
      );
    return (
      !!document.value.cwd &&
      normalizePathForIdentity(document.value.cwd) ===
        normalizePathForIdentity(store.project.rootPath)
    );
  }
  async readAt(
    store: WorkflowStore,
    kind: WorkflowKind,
    id: string,
    budget?: { remaining: number },
    acceptDefinitionKinds = false,
  ): Promise<LocatedWorkflow | null> {
    const directory = this.ports.stores.directory(store, kind);
    if (!(await workflowDirectory(store.boundary, directory))) return null;
    const file = this.ports.stores.file(store, kind, id);
    const bytes = await readWorkflowFile(
      file,
      budget ? Math.min(2 * 1024 * 1024, budget.remaining) : undefined,
    );
    if (bytes === null) return null;
    if (budget) budget.remaining -= Buffer.byteLength(bytes);
    let document: WorkflowDocument;
    try {
      const value: unknown = JSON.parse(bytes);
      const actualKind = kind === "graph" || kind === "ai" ? identifyDefinition(value) : kind;
      if (!acceptDefinitionKinds && actualKind !== kind) return null;
      document = parseWorkflowDocument(actualKind, value);
      if (document.value.id !== id)
        throw new WorkflowError("invalid", "Workflow filename and record identity disagree.");
      assertDocumentBudget(document);
    } catch (error) {
      throw new WorkflowError(
        "invalid",
        "Workflow data is invalid or exceeds supported limits. Original bytes are preserved for inspection/recovery.",
        { cause: error },
      );
    }
    if (!(await this.belongs(document, store))) return null;
    return {
      entry: {
        ref: {
          scope: store.scope,
          location: store.location,
          storeKey: store.storeKey,
          kind: document.kind,
          id,
        },
        revision: workflowDigest(bytes),
        document,
      },
      store,
      bytes,
    };
  }
  async locate(ref: WorkflowRef): Promise<LocatedWorkflow> {
    const matches: LocatedWorkflow[] = [];
    for (const store of await this.ports.stores.resolve(ref)) {
      const found = await this.readAt(store, ref.kind, ref.id);
      if (found) matches.push(found);
    }
    if (!matches.length)
      throw new WorkflowError(
        "unavailable",
        "Workflow is unavailable in the selected project and origin. Refresh its owning host.",
      );
    if (matches.length !== 1)
      throw new WorkflowError(
        "conflict",
        "More than one Workflow origin has this identity. Choose the explicit library origin.",
      );
    return matches[0];
  }
  async read(ref: WorkflowRef): Promise<WorkflowEntry> {
    return (await this.locate(ref)).entry;
  }
  private async listingStores(
    scope: WorkflowScope,
    kind: WorkflowLibraryKind,
    includeLegacy: boolean,
  ) {
    const stores = await this.ports.stores.locations(scope);
    if (includeLegacy) {
      const legacy = this.ports.stores.legacy(
        scope,
        stores[0].project,
        kind === "definition" ? "graph" : kind,
      );
      if (legacy) stores.push(legacy);
    }
    return stores;
  }
  private async candidateFiles(
    stores: WorkflowStore[],
    primary: WorkflowKind,
    diagnostics: string[],
  ) {
    const candidates: { store: WorkflowStore; id: string }[] = [];
    for (const store of stores) {
      const directory = this.ports.stores.directory(store, primary);
      try {
        if (!(await workflowDirectory(store.boundary, directory))) continue;
        const files = await readdir(directory, { withFileTypes: true });
        if (files.length > 5000) {
          diagnostics.push(
            "A Workflow directory exceeds 5,000 entries. Narrow or organize this store before listing it.",
          );
          continue;
        }
        for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
          if (!file.isFile() || !file.name.endsWith(".json")) continue;
          const id = file.name.slice(0, -5);
          try {
            assertWorkflowId(id);
            candidates.push({ store, id });
          } catch {
            diagnostics.push("An unsupported Workflow filename was preserved.");
          }
        }
      } catch {
        diagnostics.push(
          `The ${store.location} Workflow store could not be read; its files were left unchanged.`,
        );
      }
    }
    return candidates;
  }
  private async unreadable(
    candidate: { store: WorkflowStore; id: string },
    kind: WorkflowKind,
    budget: { remaining: number },
  ): Promise<WorkflowSummary> {
    let actual = kind;
    // A last-good definition identifies AI versus Graph for the explicit recovery UI, never repairs the live bytes.
    if (kind === "graph" || kind === "ai") {
      try {
        const file = path.join(
          this.ports.stores.directory(candidate.store, kind),
          ".otto-last-good",
          `${candidate.id}.json`,
        );
        if (!(await workflowDirectory(candidate.store.boundary, path.dirname(file))))
          throw new WorkflowError("unavailable", "No retained snapshot.");
        const bytes = await readWorkflowFile(file, Math.max(0, budget.remaining));
        if (bytes !== null) {
          budget.remaining -= Buffer.byteLength(bytes);
          actual = identifyDefinition(JSON.parse(bytes));
        }
      } catch {
        /* No trustworthy snapshot: retain the listed kind and offer inspection only. */
      }
    }
    return {
      ref: {
        scope: candidate.store.scope,
        kind: actual,
        id: candidate.id,
        location: candidate.store.location,
        storeKey: candidate.store.storeKey,
      },
      revision: "",
      title: `${candidate.id} (unreadable)`,
      description: "Inspect this exact origin and its retained last-good snapshot.",
      status: "unreadable",
      createdAt: "",
      updatedAt: "",
      workspaceId: null,
      conductorAgentId: null,
      error: "Original bytes are preserved. No automatic repair was performed.",
      agentCount: 0,
    };
  }
  async list(
    scope: WorkflowScope,
    kind: WorkflowLibraryKind,
    offset = 0,
    includeLegacy = false,
  ): Promise<WorkflowPage> {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
      throw new WorkflowError("invalid", "Invalid Workflow page offset.");
    const stores = await this.listingStores(scope, kind, includeLegacy);
    const diagnostics: string[] = [];
    const primary = kind === "definition" ? "graph" : kind;
    const candidates = await this.candidateFiles(stores, primary, diagnostics);
    const items: WorkflowSummary[] = [];
    let cursor = offset;
    const budget = { remaining: 16 * 1024 * 1024 };
    while (cursor < candidates.length && cursor - offset < 50 && budget.remaining > 0) {
      const candidate = candidates[cursor++];
      try {
        const found = await this.readAt(
          candidate.store,
          primary,
          candidate.id,
          budget,
          kind === "definition",
        );
        if (found) items.push(workflowSummary(found.entry));
      } catch {
        diagnostics.push(
          `Workflow ${candidate.id} in ${candidate.store.location} is unreadable, invalid or exceeds this page's budget; original bytes are retained.`,
        );
        if (candidate.store.location !== "legacy")
          items.push(await this.unreadable(candidate, primary, budget));
      }
    }
    return {
      items,
      nextOffset: cursor < candidates.length ? cursor : null,
      diagnostics: diagnostics.slice(0, 100),
      version: 0,
    };
  }
  async write(
    scope: WorkflowScope,
    document: WorkflowDocument,
    expectedRevision: string | null,
    ref?: WorkflowRef,
    location?: "repository" | "host",
  ): Promise<WorkflowEntry> {
    assertDocumentBudget(document);
    if (
      ref &&
      (ref.scope.hostId !== scope.hostId ||
        ref.scope.projectId !== scope.projectId ||
        ref.kind !== document.kind ||
        ref.id !== document.value.id)
    )
      throw new WorkflowError("invalid", "Workflow edit changed its captured identity.");
    if (expectedRevision !== null && !ref)
      throw new WorkflowError(
        "invalid",
        "Updating a Workflow requires its captured library origin.",
      );
    let store: WorkflowStore;
    if (ref) {
      const found = await this.locate(ref);
      if (found.entry.revision !== expectedRevision)
        throw new WorkflowError("conflict", "Workflow changed. Reload and review before saving.");
      store = found.store;
    } else
      store = location
        ? await this.ports.stores.at(scope, location)
        : await this.ports.stores.selected(scope);
    if (store.location === "legacy")
      throw new WorkflowError(
        "unsupported",
        "Legacy Workflow records are read-only. Explicitly copy or assign them to the project first.",
      );
    store = await this.ports.stores.pin(store);
    const directory = this.ports.stores.directory(store, document.kind);
    await workflowDirectory(store.boundary, directory, true);
    const file = this.ports.stores.file(store, document.kind, document.value.id);
    const published = documentWithOrigin(document, store);
    const text = JSON.stringify(published.value, null, 2) + "\n";
    const revision = await workflowExclusive(`${file}.transaction`, async () => {
      const accepted = await publishWorkflowFile(file, text, expectedRevision);
      const snapshots = path.join(directory, ".otto-last-good");
      await workflowDirectory(store.boundary, snapshots, true);
      const snapshot = path.join(snapshots, `${document.value.id}.json`);
      const previous = await readWorkflowFile(snapshot);
      await publishWorkflowFile(
        snapshot,
        text,
        previous === null ? null : workflowDigest(previous),
      );
      return accepted;
    });
    this.ports.changed?.(scope);
    return {
      ref: {
        scope,
        kind: document.kind,
        id: document.value.id,
        location: store.location,
        storeKey: store.storeKey,
      },
      revision,
      document: published,
    };
  }
  async remove(ref: WorkflowRef, expectedRevision: string): Promise<void> {
    const found = await this.locate(ref);
    if (found.entry.revision !== expectedRevision)
      throw new WorkflowError("conflict", "Workflow changed before deletion.");
    if (found.store.location === "legacy")
      throw new WorkflowError(
        "unsupported",
        "Legacy host records are preserved; use explicit transfer instead of deleting shared history.",
      );
    const document = found.entry.document;
    if (
      document.kind === "run" &&
      !["done", "failed", "canceled", "draft"].includes(document.value.status)
    )
      throw new WorkflowError("busy", "Cancel an active Workflow before deleting its history.");
    if (document.kind === "graph" && document.value.builtIn)
      throw new WorkflowError("unsupported", "Copy a starter Graph before editing or deleting it.");
    const file = this.ports.stores.file(found.store, ref.kind, ref.id);
    await workflowExclusive(`${file}.transaction`, () =>
      retireWorkflowFile(file, expectedRevision),
    );
    this.ports.changed?.(ref.scope);
  }
}
