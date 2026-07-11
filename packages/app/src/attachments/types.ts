import type {
  AgentAttachment,
  GitHostingProviderId,
  GitHubSearchItem,
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
    itemCount?: number;
  };
}

export type UserComposerAttachment =
  | { kind: "image"; metadata: AttachmentMetadata }
  | { kind: "file"; attachment: UploadedFileAttachment }
  // `provider` records which hosting provider served the search item; absent
  // means GitHub (legacy drafts and GitHub-project searches).
  | { kind: "github_issue"; item: GitHubSearchItem; provider?: GitHostingProviderId }
  | { kind: "github_pr"; item: GitHubSearchItem; provider?: GitHostingProviderId };

/**
 * A workspace file, folder, or specific line the user attached (from the file
 * explorer or project search) as prompt context.
 */
export interface FileContextAttachment {
  kind: "file_context";
  /** Dedupe id within a scope: the path, or `${path}:${lineStart}` for a line. */
  id: string;
  path: string;
  /** Whether the path is a file or a folder; absent means file. */
  entryKind?: "file" | "directory";
  /** 1-based line number, when this attachment targets a specific line rather than the whole file. */
  lineStart?: number;
}

export type WorkspaceComposerAttachment =
  | {
      kind: "browser_element";
      attachment: BrowserElementAttachment;
    }
  | PullRequestContextAttachment
  | ChatHistoryContextAttachment
  | FileContextAttachment
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
}
