import type { KnowledgeReviewDirective } from "@getpaseo/plugin/otto/project-knowledge";
import type { ReviewSelection } from "./review-model";
import type { ReactNode } from "react";
export interface ReviewSurfaceProps {
  body: string;
  hostId: string;
  notes: readonly KnowledgeReviewDirective[];
  onSelection(selection: ReviewSelection | null, kind: "replace" | "refine"): void;
  onEditNote(id: string): void;
  editor: ReactNode;
  onCloseEditor(): void;
}
