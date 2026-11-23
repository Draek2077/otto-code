import path from "node:path";
import {
  readKnowledgeHostDefaults,
  saveKnowledgeHostDefaults,
} from "@getpaseo/plugin/otto/project-knowledge";
import type { OttoProjectMetadata, OttoProjectSnapshot } from "../project-metadata.js";
import { KnowledgeHostDefaultsStore } from "./host-defaults.js";
import { knowledgePathExists } from "./knowledge-files.js";
import { assertSafeSegment, repositoryStoreExists, type KnowledgeStore } from "./store-resolver.js";

interface KnowledgeHostSettingsPorts {
  hostId: string;
  home: string;
  metadata: Pick<OttoProjectMetadata, "retainKnowledgeHostStores">;
  changed(): void;
}
/** Host preferences share the daemon's project registry queue during publication.
 * Neither inspection nor a default change allocates or migrates a project store. */
export class KnowledgeHostSettings {
  readonly defaults: KnowledgeHostDefaultsStore;
  constructor(private readonly ports: KnowledgeHostSettingsPorts) {
    this.defaults = new KnowledgeHostDefaultsStore(ports.home);
  }
  invoke(method: string, value: unknown): Promise<unknown> | undefined {
    if (method === readKnowledgeHostDefaults.name) return this.read(value);
    if (method === saveKnowledgeHostDefaults.name) return this.save(value);
    return undefined;
  }
  private hostError(hostId: string) {
    // Validate the selected owner before even reading that owner's filesystem.
    return hostId !== this.ports.hostId
      ? { ok: false, error: { code: "wrong_host", message: "Select the owning host." } }
      : null;
  }
  private async read(value: unknown) {
    const input = readKnowledgeHostDefaults.input.parse(value);
    const error = this.hostError(input.hostId);
    if (error) return error;
    return readKnowledgeHostDefaults.output.parse({ ok: true, value: await this.defaults.read() });
  }
  private async save(value: unknown) {
    const input = saveKnowledgeHostDefaults.input.parse(value);
    const error = this.hostError(input.hostId);
    if (error) return error;
    try {
      const saved = await this.defaults.save({
        expectedRevision: input.expectedRevision,
        defaultStoreLocation: input.defaultStoreLocation,
        preserveAndPublish: ({ current, publish }) =>
          current.defaultStoreLocation === "host"
            ? this.ports.metadata.retainKnowledgeHostStores({
                initialized: (project) => this.initialized(project),
                publish,
              })
            : publish(),
      });
      return saveKnowledgeHostDefaults.output.parse({ ok: true, value: saved });
    } finally {
      // Partial publication can still have protective project bindings. Refresh
      // through the existing demand-owned stream, never a second UI poller.
      this.ports.changed();
    }
  }
  private async initialized(project: OttoProjectSnapshot): Promise<boolean> {
    if (!path.isAbsolute(project.rootPath)) throw new Error("Invalid canonical project root");
    if (await repositoryStoreExists(path.join(project.rootPath, ".otto"))) return false;
    const directory = project.record.knowledgeDirectoryName;
    if (directory === undefined || directory === null) return false;
    if (typeof directory !== "string") throw new Error("Invalid preserved Knowledge directory");
    assertSafeSegment(directory);
    const store: KnowledgeStore = {
      projectId: project.projectId,
      projectRoot: project.rootPath,
      location: "host",
      boundary: this.ports.home,
      base: path.join(this.ports.home, "project-knowledge", directory),
    };
    // Presence, including an incomplete/corrupt store or a first writer's lock,
    // expresses existing intent. Do not redirect it to an apparently empty store.
    return knowledgePathExists(store, store.base);
  }
}
