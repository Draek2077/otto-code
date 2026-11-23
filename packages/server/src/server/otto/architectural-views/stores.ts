import path from "node:path";
import type { ViewReference } from "@getpaseo/plugin/otto/architectural-views";
import type { KnowledgeDaemonService } from "../project-knowledge/host.js";
import { assertSafeSegment } from "../project-knowledge/store-resolver.js";
import { knowledgeProjectFields } from "../project-knowledge/project-fields.js";
import type { OttoProjectMetadata } from "../project-metadata.js";
import type { ViewLibraryPorts, ViewProjectStores } from "./library.js";
import { viewDigest } from "./specification.js";
import type { SourceDigest, ViewStore } from "./records.js";

/** Canonical Knowledge allocation is reused; a default change never hides an older origin. */
export function createViewStores(ports: {
  knowledge: KnowledgeDaemonService;
  metadata: Pick<OttoProjectMetadata, "read">;
  home: string;
}): ViewLibraryPorts {
  return {
    async resolve(projectId): Promise<ViewProjectStores> {
      const selected = await ports.knowledge.resolver.resolve(projectId);
      const project = await ports.metadata.read(projectId);
      const origin = (base: typeof selected): ViewStore => ({
        ...base,
        origin: {
          location: base.location,
          storeKey: viewDigest(JSON.stringify([base.projectId, path.resolve(base.base)])),
        },
      });
      const repository = origin({
        ...selected,
        location: "repository",
        boundary: project.rootPath,
        base: path.join(project.rootPath, ".otto"),
      });
      const stores = [repository];
      const fields = knowledgeProjectFields.parse(project.record);
      if (fields.knowledgeDirectoryName) {
        assertSafeSegment(fields.knowledgeDirectoryName);
        stores.push(
          origin({
            ...selected,
            location: "host",
            boundary: ports.home,
            base: path.join(ports.home, "project-knowledge", fields.knowledgeDirectoryName),
          }),
        );
      }
      return { selected: origin(selected), stores };
    },
    async sources(projectId: string, references: ViewReference[]): Promise<SourceDigest[]> {
      const records = references.some((reference) => reference.kind === "record")
        ? await ports.knowledge.service.catalog(projectId, true)
        : [];
      const sources: SourceDigest[] = [];
      for (const reference of references) {
        const sha256 =
          reference.kind === "root"
            ? ((await ports.knowledge.service.readRoot({ projectId, slug: reference.id }))
                ?.revision ?? null)
            : (records.find((record) => record.id === reference.id)?.revision ?? null);
        sources.push({ reference, sha256 });
      }
      return sources;
    },
  };
}
