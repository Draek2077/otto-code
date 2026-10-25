import path from "node:path";
import { randomUUID } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { z } from "zod";
import {
  inspectKnowledgeStorage,
  bindKnowledgeStorage,
  type KnowledgeScope,
  type KnowledgeStorageSetup,
} from "@getpaseo/plugin/otto/project-knowledge";
import type { OttoProjectMetadata, OttoProjectSnapshot } from "../project-metadata.js";
import type { KnowledgeHostDefaults } from "./host-defaults.js";
import { knowledgeProjectFields } from "./project-fields.js";
import { digest } from "./markdown-page.js";
import {
  KnowledgeConflictError,
  knowledgePathExists,
  readKnowledgeBytes,
  replaceKnowledgeFile,
  withKnowledgeWrite,
} from "./knowledge-files.js";
import {
  assertSafeSegment,
  hasCode,
  repositoryStoreExists,
  type KnowledgeStore,
} from "./store-resolver.js";

const marker = z.object({
  projectId: z.string().nullable(),
  rootPath: z.string(),
  projectKey: z.string().nullish(),
  updatedAt: z.string(),
});
interface StorageSetupPorts {
  home: string;
  resolveProject(scope: KnowledgeScope): Promise<OttoProjectSnapshot>;
  defaults(): Promise<KnowledgeHostDefaults>;
  metadata: Pick<OttoProjectMetadata, "update" | "knowledgeDirectoryBindings">;
  changed(projectId: string): void;
}
interface RetainedScan {
  entries: Array<{ directoryName: string; revision: string | null }>;
  candidates: KnowledgeStorageSetup["candidates"];
  otherStores: number;
}
/** Explicit missing-identity setup only. Existing bindings use copy/switch;
 * inspection never initializes, migrates or silently attaches old directories. */
export class KnowledgeStorageSetupService {
  constructor(private readonly ports: StorageSetupPorts) {}
  invoke(method: string, input: unknown): Promise<unknown> | undefined {
    if (method === inspectKnowledgeStorage.name) return this.inspect(input);
    if (method === bindKnowledgeStorage.name) return this.bind(input);
    return undefined;
  }
  private store(input: { project: OttoProjectSnapshot; directoryName: string }): KnowledgeStore {
    assertSafeSegment(input.directoryName);
    if (!path.isAbsolute(this.ports.home) || !path.isAbsolute(input.project.rootPath))
      throw new Error("Knowledge setup requires canonical host paths");
    return {
      projectId: input.project.projectId,
      projectRoot: input.project.rootPath,
      location: "host",
      boundary: this.ports.home,
      base: path.join(this.ports.home, "project-knowledge", input.directoryName),
    };
  }
  private async scan(project: OttoProjectSnapshot): Promise<RetainedScan> {
    const parent = path.join(this.ports.home, "project-knowledge");
    const parentStore: KnowledgeStore = {
      projectId: project.projectId,
      projectRoot: project.rootPath,
      location: "host",
      boundary: this.ports.home,
      base: parent,
    };
    const scan: RetainedScan = { entries: [], candidates: [], otherStores: 0 };
    if (!(await knowledgePathExists(parentStore, parent))) return scan;
    const entries = await readdir(parent, { withFileTypes: true });
    const bindings = await this.ports.metadata.knowledgeDirectoryBindings();
    if (entries.length > 1000) throw new Error("Knowledge directory inspection exceeds its limit");
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const owners = bindings.filter(
        (binding) =>
          directoryKey(binding.directoryName) === directoryKey(entry.name) &&
          binding.projectId !== project.projectId,
      );
      if (owners.length) {
        scan.entries.push({ directoryName: entry.name, revision: digest(JSON.stringify(owners)) });
        scan.otherStores++;
        continue;
      }
      const retained = await this.retained({ project, directoryName: entry.name });
      scan.entries.push({ directoryName: entry.name, revision: retained?.revision ?? null });
      if (retained?.candidate) scan.candidates.push(retained.candidate);
      else scan.otherStores++;
    }
    if (scan.candidates.length > 100)
      throw new Error("Knowledge matching store inspection exceeds its limit");
    if (Buffer.byteLength(JSON.stringify(scan.candidates), "utf8") > 24000)
      throw new Error("Knowledge matching store preview exceeds its byte limit");
    return scan;
  }
  private async retained(input: { project: OttoProjectSnapshot; directoryName: string }) {
    // Foreign/unsupported names are reported as unassigned, never offered as a
    // client path. Links below the selected owner boundary always fail closed.
    try {
      assertSafeSegment(input.directoryName);
    } catch {
      return null;
    }
    const store = this.store(input);
    if (!(await knowledgePathExists(store, store.base))) throw new KnowledgeConflictError();
    const file = path.join(store.base, "project.json");
    try {
      const info = await lstat(file);
      if (info.size > 65536) throw new Error("Knowledge ownership marker exceeds its limit");
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
    const bytes = await readKnowledgeBytes(store, file);
    if (!bytes) return null;
    let decoded: unknown;
    try {
      decoded = JSON.parse(bytes.toString("utf8"));
    } catch {
      return { revision: digest(bytes), candidate: null };
    }
    const parsed = marker.safeParse(decoded);
    const data = parsed.success ? parsed.data : null;
    const rootMatches =
      data &&
      path.isAbsolute(data.rootPath) &&
      samePath({ left: data.rootPath, right: input.project.rootPath });
    const matches = data && (data.projectId === input.project.projectId || rootMatches);
    return {
      revision: digest(bytes),
      candidate: matches ? { directoryName: input.directoryName, rootPath: data.rootPath } : null,
    };
  }
  private async plan(scope: KnowledgeScope) {
    const project = await this.ports.resolveProject(scope);
    const fields = knowledgeProjectFields.parse(project.record);
    if (!path.isAbsolute(project.rootPath)) throw new Error("Invalid canonical project root");
    if (fields.knowledgeDirectoryName) assertSafeSegment(fields.knowledgeDirectoryName);
    const defaults = await this.ports.defaults();
    const location =
      fields.knowledgeLocation ??
      ((await repositoryStoreExists(path.join(project.rootPath, ".otto")))
        ? "repository"
        : defaults.defaultStoreLocation);
    const required = location === "host" && !fields.knowledgeDirectoryName;
    const scan = required
      ? await this.scan(project)
      : { entries: [], candidates: [], otherStores: 0 };
    const plan: KnowledgeStorageSetup = {
      revision: digest(
        JSON.stringify({
          projectRevision: project.revision,
          defaults,
          fields,
          entries: scan.entries,
        }),
      ),
      required,
      label: String(project.record.customName ?? project.record.displayName ?? project.projectId),
      candidates: scan.candidates,
      otherStores: scan.otherStores,
    };
    return { project, plan, scan };
  }
  private async inspect(value: unknown) {
    const input = inspectKnowledgeStorage.input.parse(value);
    return inspectKnowledgeStorage.output.parse({
      ok: true,
      value: (await this.plan(input.scope)).plan,
    });
  }
  private async bind(value: unknown) {
    const input = bindKnowledgeStorage.input.parse(value);
    const choice = input.choice;
    const current = await this.plan(input.scope);
    if (!current.plan.required || input.expectedRevision !== current.plan.revision)
      throw new KnowledgeConflictError();
    if (choice.kind === "repository") return this.useRepository(current.project);
    if (
      choice.kind === "retained" &&
      !current.plan.candidates.some((candidate) => candidate.directoryName === choice.directoryName)
    )
      throw new KnowledgeConflictError();
    const directoryName = choice.kind === "new" ? `project-${randomUUID()}` : choice.directoryName;
    const target = this.store({ project: current.project, directoryName });
    try {
      // Persist exactly once under the canonical registry queue, before a new
      // store can be written. If marker publication fails, this identity stays
      // recoverable; never roll it back or rederive it from a display name.
      await this.ports.metadata.update({
        projectId: current.project.projectId,
        expectedRevision: current.project.revision,
        patch: { knowledgeLocation: "host", knowledgeDirectoryName: directoryName },
        beforePublish: async () => {
          if (choice.kind === "new") {
            if (await knowledgePathExists(target, target.base)) throw new KnowledgeConflictError();
          } else {
            const bytes = await readKnowledgeBytes(target, path.join(target.base, "project.json"));
            if (
              !bytes ||
              digest(bytes) !==
                current.scan.entries.find((entry) => entry.directoryName === directoryName)
                  ?.revision
            )
              throw new KnowledgeConflictError();
          }
        },
      });
      if (choice.kind === "new") await this.markNew({ project: current.project, directoryName });
      return bindKnowledgeStorage.output.parse({
        ok: true,
        value: { location: "host", directoryName },
      });
    } finally {
      this.ports.changed(current.project.projectId);
    }
  }
  private async useRepository(project: OttoProjectSnapshot) {
    try {
      await this.ports.metadata.update({
        projectId: project.projectId,
        expectedRevision: project.revision,
        patch: { knowledgeLocation: "repository" },
      });
      return bindKnowledgeStorage.output.parse({
        ok: true,
        value: { location: "repository", directoryName: null },
      });
    } finally {
      this.ports.changed(project.projectId);
    }
  }
  private async markNew(input: { project: OttoProjectSnapshot; directoryName: string }) {
    const store = this.store(input);
    await withKnowledgeWrite(store, () =>
      replaceKnowledgeFile({
        store,
        file: path.join(store.base, "project.json"),
        expectedRevision: null,
        body: `${JSON.stringify({ projectId: input.project.projectId, projectKey: typeof input.project.record.projectKey === "string" ? input.project.record.projectKey : null, rootPath: input.project.rootPath, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      }),
    );
  }
}
function samePath(input: { left: string; right: string }) {
  const left = path.resolve(input.left);
  const right = path.resolve(input.right);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
function directoryKey(value: string) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}
