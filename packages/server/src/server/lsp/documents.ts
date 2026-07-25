import type { Logger } from "pino";
import type { LspConnection } from "./connection.js";
import type { BoundServer, LspServerPool } from "./pool.js";
import { languageIdForPath } from "./registry.js";
import { documentKey, toFileUri } from "./uri.js";

/**
 * The daemon's mirror of the editor's open buffers, and the thing that keeps every
 * bound language server's view of them current.
 *
 * Two properties make this correct rather than approximately correct:
 *
 * **Answers come from the draft, not the disk.** A definition resolved against saved
 * content is a subtly wrong answer whenever there are unsaved edits — which, in an
 * editor, is most of the time.
 *
 * **A server that starts late still sees the document.** Servers spawn lazily on the
 * first query, long after the edits that produced the current text. Such a server is
 * handed the latest text as a `didOpen`; it is never replayed a `didChange` for a
 * baseline it does not have. The same rule covers a server that crashed and restarted,
 * which is why the per-document record tracks *which connection* holds it open rather
 * than merely which server id.
 */

export interface LspDocumentsOptions {
  pool: LspServerPool;
  logger: Logger;
}

export interface SyncDocumentInput {
  rootPath: string;
  filePath: string;
  text: string;
}

export interface CloseDocumentInput {
  rootPath: string;
  filePath: string;
}

interface OpenDocument {
  rootPath: string;
  filePath: string;
  uri: string;
  languageId: string;
  version: number;
  text: string;
  /** serverId → the connection that received `didOpen` for this version stream. */
  openedIn: Map<string, LspConnection>;
}

export class LspDocuments {
  private readonly pool: LspServerPool;
  private readonly logger: Logger;
  private readonly documents = new Map<string, OpenDocument>();

  constructor(options: LspDocumentsOptions) {
    this.pool = options.pool;
    this.logger = options.logger.child({ subsystem: "lsp-documents" });
  }

  uriFor(filePath: string): string {
    return toFileUri(filePath);
  }

  openCount(): number {
    return this.documents.size;
  }

  /**
   * The open document with this canonical identity, or null.
   *
   * Diagnostics arrive addressed by the server's own URI spelling, and what the client
   * needs back is the path *it* opened — those differ by drive-letter case, by `/` vs `\`,
   * and by percent-encoding. Echoing the server's spelling would produce a document the
   * client cannot match to any open tab.
   */
  find(key: string): { rootPath: string; filePath: string } | null {
    const document = this.documents.get(key);
    return document === undefined
      ? null
      : { rootPath: document.rootPath, filePath: document.filePath };
  }

  /**
   * Record the buffer's current text. Deliberately does not start a server: editing
   * is not a reason to pay for a language server, querying is.
   */
  async sync(input: SyncDocumentInput): Promise<void> {
    const key = documentKey(input.filePath);
    const existing = this.documents.get(key);

    if (existing === undefined) {
      this.documents.set(key, {
        rootPath: input.rootPath,
        filePath: input.filePath,
        uri: toFileUri(input.filePath),
        languageId: languageIdForPath(input.filePath),
        version: 1,
        text: input.text,
        openedIn: new Map(),
      });
      return;
    }

    if (existing.text === input.text) {
      return;
    }

    existing.version += 1;
    existing.text = input.text;
    this.notifyChanged(existing);
  }

  /**
   * Every server bound to this document, each guaranteed to have seen it. This is the
   * entry point for a query — it is what makes a lazily-spawned server usable.
   */
  async serversFor(rootPath: string, filePath: string): Promise<BoundServer[]> {
    const bound = await this.pool.serversForDocument(rootPath, filePath);
    const document = this.documents.get(documentKey(filePath));

    if (document === undefined) {
      return bound;
    }

    for (const entry of bound) {
      if (document.openedIn.get(entry.serverId) === entry.connection) {
        continue;
      }
      this.sendOpen(document, entry);
    }

    return bound;
  }

  async close(input: CloseDocumentInput): Promise<void> {
    const key = documentKey(input.filePath);
    const document = this.documents.get(key);
    if (document === undefined) {
      return;
    }

    for (const connection of document.openedIn.values()) {
      this.trySend(connection, () =>
        connection.notify("textDocument/didClose", {
          textDocument: { uri: document.uri },
        }),
      );
    }
    this.documents.delete(key);
  }

  async closeWorkspace(rootPath: string): Promise<void> {
    const workspaceKey = documentKey(rootPath);
    const closing = [...this.documents.values()].filter(
      (document) => documentKey(document.rootPath) === workspaceKey,
    );

    for (const document of closing) {
      await this.close({ rootPath: document.rootPath, filePath: document.filePath });
    }
  }

  private sendOpen(document: OpenDocument, entry: BoundServer): void {
    const sent = this.trySend(entry.connection, () =>
      entry.connection.notify("textDocument/didOpen", {
        textDocument: {
          uri: document.uri,
          languageId: document.languageId,
          version: document.version,
          text: document.text,
        },
      }),
    );

    if (sent) {
      document.openedIn.set(entry.serverId, entry.connection);
    }
  }

  private notifyChanged(document: OpenDocument): void {
    for (const [serverId, connection] of document.openedIn) {
      const live = this.pool.peek(document.rootPath, serverId);
      if (live !== connection) {
        // Restarted or reaped since it was opened: drop the record so the next
        // query re-opens it at the current version instead of sending a change
        // against a baseline the new process never saw.
        document.openedIn.delete(serverId);
        continue;
      }

      this.trySend(connection, () =>
        connection.notify("textDocument/didChange", {
          textDocument: { uri: document.uri, version: document.version },
          contentChanges: [{ text: document.text }],
        }),
      );
    }
  }

  private trySend(connection: LspConnection, send: () => void): boolean {
    if (!connection.isRunning) {
      return false;
    }
    try {
      send();
      return true;
    } catch (error) {
      this.logger.debug({ err: error }, "dropped document notification for a dead server");
      return false;
    }
  }
}
