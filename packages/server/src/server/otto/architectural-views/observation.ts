import { z } from "zod";
import { ViewOrigin, type ViewIdentity } from "@getpaseo/plugin/otto/architectural-views";
import {
  KnowledgeObservations,
  knowledgeObservationPlan,
} from "../project-knowledge/observation.js";
import type { ViewLibrary } from "./library.js";

const feed = z.tuple([z.string(), ViewOrigin]);
/** Reuse the proven lease/lifetime owner; observe only both explicitly bound store subtrees. */
export class ViewObservations {
  private readonly owner: KnowledgeObservations;
  constructor(readonly library: ViewLibrary) {
    this.owner = new KnowledgeObservations({
      resolve: async (key) => {
        const [projectId, origin] = feed.parse(JSON.parse(key));
        return library.store(projectId, { viewId: "observation", origin });
      },
      plan: (store) =>
        knowledgeObservationPlan(store, ["knowledge", "KNOWLEDGE.md", "architectural-views"]),
    });
  }
  async wait(
    clientId: string,
    leaseId: string,
    projectId: string,
    origin: ViewIdentity["origin"],
    cursor: string | null,
  ) {
    await this.library.store(projectId, { viewId: "observation", origin });
    const result = await this.owner.wait(
      clientId,
      leaseId,
      JSON.stringify([projectId, origin]),
      cursor,
    );
    return {
      cursor: result.cursor,
      error: result.error
        ? "External View refresh is unavailable. Refresh manually or reopen this page."
        : null,
    };
  }
  async notify(projectId: string): Promise<void> {
    const project = await this.library.ports.resolve(projectId);
    for (const store of project.stores)
      this.owner.notify(JSON.stringify([projectId, store.origin]));
  }
  release(clientId: string, leaseId: string) {
    return this.owner.release(clientId, leaseId);
  }
  releaseClient(clientId: string) {
    return this.owner.releaseClient(clientId);
  }
  close() {
    return this.owner.close();
  }
}
