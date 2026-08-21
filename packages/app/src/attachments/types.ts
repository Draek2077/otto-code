import type {
  AgentAttachment,
  ForgeSearchItem,
  UploadedFileAttachment,
} from "@otto-code/protocol/messages";

export type AttachmentStorageType = "web-indexeddb" | "desktop-file" | "native-file";

export interface AttachmentMetadata {
  id: string;
  mimeType: string;
  storageType: AttachmentStorageType;
  /**
   * Platform-specific location key.
   * - web-indexeddb: object store key
   * - desktop-file/native-file: absolute file path without preview URL indirection
   */
  storageKey: string;
  fileName?: string | null;
  byteSize?: number | null;
  createdAt: number;
}

export interface BrowserElementAttachment {
  url: string;
  selector: string;
  tag: string;
  text: string;
  outerHTML: string;
  computedStyles: Record<string, string>;
  boundingRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  reactSource: {
    fileName: string | null;
    lineNumber: number | null;
    columnNumber: number | null;
    componentName: string | null;
  } | null;
  parentChain: string[];
  children: string[];
  /** Free-text review note the user wrote about this element, if any. */
  comment?: string;
  /**
   * Cropped screenshot of the selected element, sent to the agent as an image
   * alongside the textual element context. Persisted via the attachment store;
   * referenced by id so the draft-store GC keeps it alive.
   */
  screenshot?: AttachmentMetadata;
  formatted: string;
}

export type PullRequestContextAttachmentKind =
  | "forge.change_request_comment"
  | "forge.change_request_review"
  | "forge.change_request_check"
  | "github.pull_request_comment"
  | "github.pull_request_review"
  | "github.pull_request_check";

interface PullRequestContextAttachmentFields {
  id: string;
  title: string;
  subtitle?: string;
  text: string;
  url?: string | null;
}

export type PullRequestContextAttachment =
  | ({ kind: "forge.change_request_comment" } & PullRequestContextAttachmentFields)
  | ({ kind: "forge.change_request_review" } & PullRequestContextAttachmentFields)
  | ({ kind: "forge.change_request_check" } & PullRequestContextAttachmentFields)
  | ({ kind: "github.pull_request_comment" } & PullRequestContextAttachmentFields)
  | ({ kind: "github.pull_request_review" } & PullRequestContextAttachmentFields)
  | ({ kind: "github.pull_request_check" } & PullRequestContextAttachmentFields);

export interface ChatHistoryContextAttachment {
  kind: "chat_history";
  id: string;
  attachment: Extract<AgentAttachment, { type: "text" }>;
  source: {
    serverId: string;
    agentId: string;
    boundaryMessageId?: string | null;
    boundaryCursor?: { epoch: string; seq: number } | null;
    itemCount?: number;
  };
}

/** A daemon-retained meeting transcript selected as context for the current chat. */
export interface MeetingTranscriptContextAttachment {
  kind: "meeting_transcript";
  id: string;
  title: string;
  content: string;
  occurredAt: string;
}

export const NEW_WORKSPACE_PICKER_ATTACHMENT_OWNER = "new-workspace-picker";

export type WorkspaceFileSelection =
  | { kind: "whole_file" }
  | { kind: "line_range"; startLine: number; endLine: number };

export interface WorkspaceFileComposerAttachment {
  kind: "workspace_file";
  path: string;
  selection: WorkspaceFileSelection;
}

export type UserComposerAttachment =
  | { kind: "image"; metadata: AttachmentMetadata }
  | { kind: "file"; attachment: UploadedFileAttachment }
  | WorkspaceFileComposerAttachment
  // `ForgeSearchItem` carries its own `forge` tag, which is what Otto's
  // separate `provider` field used to record.
  | { kind: "forge_issue"; item: ForgeSearchItem }
  | { kind: "forge_change_request"; item: ForgeSearchItem }
  // COMPAT(githubAttachmentKinds): added in v0.1.106, remove after 2026-12-28 once daemon floor >= v0.1.106
  | { kind: "github_issue"; item: ForgeSearchItem }
  | {
      kind: "github_pr";
      item: ForgeSearchItem;
      owner?: typeof NEW_WORKSPACE_PICKER_ATTACHMENT_OWNER;
    };

/**
 * A row:column span inside a file, as the editor reported it when the user
 * attached a selection.
 *
 * Both ends are 1-based and columns count UTF-16 code units, matching
 * `EditorSelection` and the editor status bar - the range on the pill is the
 * range the user was just looking at in the gutter.
 */
export interface FileContextSelection {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/**
 * A workspace file, folder, specific line, or selected range the user attached
 * (from the file explorer, project search, the editor, or an `@` mention) as
 * prompt context. Distinct from {@link WorkspaceFileComposerAttachment}, which
 * is the composer-side pill.
 */
export interface FileContextAttachment {
  kind: "file_context";
  /**
   * Dedupe id within a scope: the path, `${path}:${lineStart}` for a line, or
   * `${path}:${startLine}:${startColumn}-${endLine}:${endColumn}` for a
   * selection. Build it with `buildFileContextAttachmentId` rather than by
   * hand - five entry points now write these, and two spellings of one target
   * would leave the user with duplicate pills that each need removing.
   */
  id: string;
  path: string;
  /** Whether the path is a file or a folder; absent means file. */
  entryKind?: "file" | "directory";
  /** 1-based line number, when this attachment targets a specific line rather than the whole file. */
  lineStart?: number;
  /**
   * The selected range, when the user attached a selection rather than the
   * whole file. Carried as a reference, not an excerpt: the agent reads the
   * file itself, so the range costs one line of prompt instead of the text -
   * and stays correct if the file changes before the turn runs.
   */
  selection?: FileContextSelection;
}

/** A user annotation of a source-backed item in a rendered workspace document. */
export interface RenderedDocumentContextAttachment {
  kind: "rendered_document";
  /** Stable within the current workspace attachment scope. */
  id: string;
  path: string;
  locator: {
    kind: "heading";
    level: number;
    lineStart: number;
    lineEnd: number;
    text: string;
  };
  /** The rendered item's source excerpt, retained so the prompt remains useful after edits. */
  excerpt: string;
  /** The user's reason for attaching the rendered item. */
  comment: string;
}

export type WorkspaceComposerAttachment =
  | {
      kind: "browser_element";
      attachment: BrowserElementAttachment;
    }
  | PullRequestContextAttachment
  | ChatHistoryContextAttachment
  | MeetingTranscriptContextAttachment
  | FileContextAttachment
  | RenderedDocumentContextAttachment
  | {
      kind: "review";
      attachment: Extract<AgentAttachment, { type: "review" }>;
      reviewDraftKey: string;
      commentCount: number;
    };

export type ComposerAttachment = UserComposerAttachment | WorkspaceComposerAttachment;

export type AttachmentDataSource =
  | { kind: "bytes"; bytes: Uint8Array }
  | { kind: "blob"; blob: Blob }
  | { kind: "data_url"; dataUrl: string }
  | { kind: "file_uri"; uri: string };

export interface SaveAttachmentInput {
  id?: string;
  mimeType?: string;
  fileName?: string | null;
  source: AttachmentDataSource;
}

export interface ResolvePreviewUrlInput {
  attachment: AttachmentMetadata;
}

export interface ReleasePreviewUrlInput {
  attachment: AttachmentMetadata;
  url: string;
}

export interface EncodeAttachmentInput {
  attachment: AttachmentMetadata;
}

export interface DeleteAttachmentInput {
  attachment: AttachmentMetadata;
}

export interface GarbageCollectInput {
  referencedIds: ReadonlySet<string>;
}

/**
 * What the Storage settings section reports, split the way the lifecycle splits:
 * `preview` is the regenerable cache of images that live elsewhere, `other` is
 * everything the user attached to a message. See docs/attachment-lifecycle.md.
 */
export interface AttachmentStoreUsage {
  previewCount: number;
  previewBytes: number;
  otherCount: number;
  otherBytes: number;
}

/** The empty reading, shared so "nothing stored" has one spelling. */
export const EMPTY_ATTACHMENT_STORE_USAGE: AttachmentStoreUsage = Object.freeze({
  previewCount: 0,
  previewBytes: 0,
  otherCount: 0,
  otherBytes: 0,
});

export interface ClearPreviewAttachmentsResult {
  deleted: number;
  freedBytes: number;
}

/**
 * Async storage contract for attachment bytes.
 * Metadata is persisted in drafts/messages; bytes live in platform stores.
 */
export interface AttachmentStore {
  readonly storageType: AttachmentStorageType;
  save(input: SaveAttachmentInput): Promise<AttachmentMetadata>;
  encodeBase64(input: EncodeAttachmentInput): Promise<string>;
  resolvePreviewUrl(input: ResolvePreviewUrlInput): Promise<string>;
  releasePreviewUrl?(input: ReleasePreviewUrlInput): Promise<void>;
  delete(input: DeleteAttachmentInput): Promise<void>;
  garbageCollect(input: GarbageCollectInput): Promise<void>;
  /** Sizes the store for the Storage settings section. */
  usage(): Promise<AttachmentStoreUsage>;
  /**
   * Drops every preview attachment. Safe by construction - each one is a copy of
   * an image the daemon or the workspace still holds, so the next render refetches.
   */
  clearPreviews(): Promise<ClearPreviewAttachmentsResult>;
}
