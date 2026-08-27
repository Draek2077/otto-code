import type { KnowledgeReviewDirective } from "./review-session";

export interface KnowledgeReviewSurfaceProps {
  /** Full Markdown rendered in the reader, including record metadata. */
  source: string;
  /** Markdown body the review is permitted to rewrite. */
  directiveSource: string;
  directives: readonly KnowledgeReviewDirective[];
  enabled: boolean;
  /** Returns the directive id so the new note can open immediately. */
  onAdd: (directive: Omit<KnowledgeReviewDirective, "id">) => string;
  onUpdate: (id: string, update: Pick<KnowledgeReviewDirective, "kind" | "value">) => void;
  onRemove: (id: string) => void;
  onSelectionError: (message: string | null) => void;
}
