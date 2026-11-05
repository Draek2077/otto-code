import type {
  EditorPlan,
  EditorEditOutcome,
  EditorSearchResult,
  EditorSearchOptions,
} from "@getpaseo/plugin/otto/editor";
import type { CodeLocation } from "./surface";
export interface EditorReviewSnapshot {
  panel: string;
  editLabel: string;
  error: string | null;
  busy: boolean;
  plan: EditorPlan | null;
  outcome: EditorEditOutcome | null;
}
export interface EditorReviewPort {
  getSnapshot(): EditorReviewSnapshot;
  subscribe(listener: () => void): () => void;
  closePanel(): void;
  applyRename(): Promise<void>;
  undoRename(): Promise<void>;
}
export interface EditorSearchPort {
  readonly contextScope: { hostId: string; root: string; workspaceId?: string | null };
  getSnapshot(): EditorReviewSnapshot & { search: EditorSearchResult | null };
  subscribe(listener: () => void): () => void;
  navigate(location: CodeLocation): void;
  toggleSearch(): void;
  searchFiles(options: EditorSearchOptions): Promise<void>;
  planReplace(replacement: string, files: string[]): Promise<void>;
}
