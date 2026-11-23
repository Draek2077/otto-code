import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OttoProjectSnapshot, OttoProjectUpdate } from "../../project-metadata.js";
import { WorkflowStores } from "../stores.js";
import { WorkflowLibrary } from "../library.js";
import { WorkflowError, workflowDigest } from "../files.js";
import {
  DEFAULT_WORKFLOW_LIMITS,
  type WorkflowDocument,
  type WorkflowScope,
} from "@getpaseo/plugin/otto/workflows";

export async function workflowFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "otto-workflow-store-"));
  const home = path.join(root, "home");
  const repo = path.join(root, "repo");
  const other = path.join(root, "other");
  await mkdir(home);
  await mkdir(repo);
  await mkdir(other);
  const records = new Map<string, OttoProjectSnapshot>();
  const put = (projectId: string, rootPath: string, record: Record<string, unknown>) => {
    const snapshot = {
      projectId,
      rootPath,
      record,
      revision: workflowDigest(JSON.stringify(record)),
    };
    records.set(projectId, snapshot);
    return snapshot;
  };
  put("project-1", repo, {
    displayName: "Example",
    knowledgeLocation: "host",
    artifactLocation: "host",
    future: { keep: true },
  });
  put("project-2", other, { displayName: "Other" });
  const metadata = {
    async read(id: string) {
      const found = records.get(id);
      if (!found) throw new WorkflowError("unavailable", "Unknown fixture project");
      return structuredClone(found);
    },
    async update(input: OttoProjectUpdate) {
      const before = await this.read(input.projectId);
      if (before.revision !== input.expectedRevision)
        throw new WorkflowError("conflict", "Fixture project changed");
      await input.beforePublish?.();
      return put(before.projectId, before.rootPath, { ...before.record, ...input.patch });
    },
  };
  const stores = new WorkflowStores({
    home,
    hostId: "host-1",
    hostLabel: "Fixture host",
    metadata,
  });
  let changes = 0;
  const library = new WorkflowLibrary({
    stores,
    changed: () => {
      changes++;
    },
    legacyWorkspaceProject: async (id) => (id === "worktree-1" ? "project-1" : null),
  });
  const scope: WorkflowScope = { hostId: "host-1", projectId: "project-1" };
  return {
    root,
    home,
    repo,
    other,
    scope,
    stores,
    library,
    metadata,
    records,
    put,
    changes: () => changes,
    async cleanup() {
      if (
        path.dirname(root) !== path.resolve(tmpdir()) ||
        !path.basename(root).startsWith("otto-workflow-store-")
      )
        throw new Error("Refusing unrelated fixture cleanup");
      await rm(root, { recursive: true, force: true });
    },
  };
}
export function graphDocument(id = "example"): Extract<WorkflowDocument, { kind: "graph" }> {
  return {
    kind: "graph",
    value: { id, name: "Example Graph", nodes: [], edges: [], future: { retained: true } },
  };
}
export function aiDocument(id = "ai-example"): Extract<WorkflowDocument, { kind: "ai" }> {
  const seat = { provider: "fixture", model: "fixture-model" };
  return {
    kind: "ai",
    value: {
      format: "otto.workflow.ai",
      formatVersion: 1,
      id,
      title: "Example AI",
      prompt: "Investigate and report",
      seats: { conductor: seat, worker: seat, judge: seat },
      limits: DEFAULT_WORKFLOW_LIMITS,
      autopilot: false,
      createdAt: "2026-11-05T00:00:00Z",
      updatedAt: "2026-11-05T00:00:00Z",
    },
  };
}
