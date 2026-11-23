import type {
  KnowledgeScope,
  KnowledgeRefinementTarget,
} from "@getpaseo/plugin/otto/project-knowledge";
import { KnowledgeReviewModel, type ReviewPort } from "./review-model";
/** Installation-local drafts, scoped to the actual host/project/article, never persisted or injected. */
export class KnowledgeReviews {
  private entries = new Map<string, KnowledgeReviewModel>();
  private listeners = new Set<() => void>();
  private version = 0;
  getSnapshot = () => this.version;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private key(scope: KnowledgeScope, target: KnowledgeRefinementTarget) {
    return JSON.stringify([
      scope.hostId,
      scope.target.kind,
      scope.target.id,
      target.type,
      target.type === "page" ? [target.kind, target.id] : target.slug,
    ]);
  }
  get(scope: KnowledgeScope, target: KnowledgeRefinementTarget) {
    return this.entries.get(this.key(scope, target));
  }
  open(scope: KnowledgeScope, target: KnowledgeRefinementTarget, base: string, port: ReviewPort) {
    const current = this.get(scope, target);
    if (current) return current;
    if (this.entries.size >= 16)
      throw new Error("Finish or discard an existing article review before opening another.");
    const model = new KnowledgeReviewModel(target, base, port);
    this.entries.set(this.key(scope, target), model);
    this.changed();
    return model;
  }
  discard(scope: KnowledgeScope, model: KnowledgeReviewModel) {
    if (model.getSnapshot().busy || this.get(scope, model.target) !== model) return false;
    this.entries.delete(this.key(scope, model.target));
    this.changed();
    return true;
  }
  private changed() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}
const owners = new WeakMap<object, KnowledgeReviews>();
export function knowledgeReviewsFor(installation: object) {
  let owner = owners.get(installation);
  if (!owner) {
    owner = new KnowledgeReviews();
    owners.set(installation, owner);
  }
  return owner;
}
