/**
 * Repo-owned project knowledge. Markdown is canonical so it is readable and
 * reviewable in Git without Otto. The daemon is the normal writer and keeps
 * the current-truth/timeline invariant intact.
 */
export type ProjectKnowledgeKind =
  | "decision"
  | "constraint"
  | "requirement"
  | "architecture"
  | "finding"
  | "project"
  | "reference";
export type ProjectKnowledgeStatus = "proposed" | "confirmed" | "superseded";
export type ProjectDeliveryStatus =
  | "charter"
  | "in_build"
  | "partial"
  | "blocked"
  | "complete"
  | "reference"
  | "deferred"
  | "cancelled";
export type ProjectReferenceDisposition =
  | "unevaluated"
  | "read"
  | "adopted"
  | "rejected"
  | "dependency";

export interface ProjectProgress {
  completed: number;
  total: number;
  unit: string;
}

export interface ProjectKnowledgeTimelineEntry {
  /** Brain.md-compatible append-only event kinds, plus legacy kinds we still read. */
  kind:
    | "decision"
    | "evidence"
    | "reversal"
    | "note"
    | "created"
    | "truth_updated"
    | "status_changed"
    | "migration";
  text: string;
  recordedAt: string;
  source?: string;
  affects?: string[];
}

export interface ProjectKnowledgeRecord {
  id: string;
  kind: ProjectKnowledgeKind;
  title: string;
  /** The page's compiled current truth. */
  statement: string;
  /** Present on catalog summaries so importers can verify content without loading full bodies. */
  statementDigest?: string;
  evidence?: string;
  tags: string[];
  status: ProjectKnowledgeStatus;
  /** Delivery lifecycle, independent from whether the charter itself is reviewed knowledge. */
  deliveryStatus?: ProjectDeliveryStatus;
  /** Structured project completion metric. Percentage is always derived. */
  progress?: ProjectProgress;
  /** Evaluation outcome for reference pages. */
  referenceDisposition?: ProjectReferenceDisposition;
  /** External canonical location when the reference has one. */
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
  /** Append-only evidence and reasons behind each change. */
  provenance?: ProjectKnowledgeTimelineEntry[];
  /**
   * Canonical Markdown page, relative to the store's path base: the project
   * root for a repository store, the store directory for a host store.
   */
  path?: string;
  /**
   * Absolute on-disk page. The only path a client can act on for a host store,
   * where `path` resolves against nothing the client knows about.
   */
  absolutePath?: string;
}

export type ProjectKnowledgeHealthKind = "stale" | "overlapping_tags" | "overlapping_statement";
/** A review signal about the health of stored knowledge, not a persisted finding record. */
export interface ProjectKnowledgeHealth {
  kind: ProjectKnowledgeHealthKind;
  recordId: string;
  relatedRecordId?: string;
  /** Present for tag-overlap findings so review UI can distinguish taxonomy from identical tag sets. */
  tagOverlap?: "complete" | "partial";
  /** The normalized tags both records share, when the finding concerns tags. */
  sharedTags?: string[];
  message: string;
}

export interface ProjectKnowledgeRootPage {
  slug: string;
  title: string;
  path: string;
  /** Absolute on-disk page; see `ProjectKnowledgeRecord.absolutePath`. */
  absolutePath?: string;
  body: string;
}

export interface ProjectKnowledgeBrokenLink {
  source: string;
  target: string;
}

/** Kept only to import the unshipped JSON foundation on first access. */
export interface LegacyProjectKnowledgeFile {
  version: 1;
  records: ProjectKnowledgeRecord[];
}
