import { readFile, stat } from "node:fs/promises";
import type { Logger } from "pino";
import type { LspConnection } from "./connection.js";
import type { BoundServer, LspServerPool } from "./pool.js";
import { languageIdForPath } from "./registry.js";
import { documentKey, toFileUri } from "./uri.js";

/**
 * The daemon's mirror of the editor's open buffers, and the thing that keeps every
 * bound language server's view of them current.
 *
 * Three properties make this correct rather than approximately correct:
 *
 * **Answers come from the draft, not the disk.** A definition resolved against saved
 * content is a subtly wrong answer whenever there are unsaved edits - which, in an
 * editor, is most of the time.
 *
 * **A server that starts late still sees the document.** Servers spawn lazily on the
 * first query, long after the edits that produced the current text. Such a server is
 * handed the latest text as a `didOpen`; it is never replayed a `didChange` for a
 * baseline it does not have. The same rule covers a server that crashed and restarted,
 * which is why the per-document record tracks *which connection* holds it open rather
 * than merely which server id.
 *
 * **A query never depends on some other tab being open.** When a position query names a
 * file no editor is mirroring, the file is loaded from disk and opened before the query
 * goes out. Without this, a language server that was never sent `didOpen` for the URI
 * answers *empty* - not an error, just nothing - and the caller reports "no references"
 * about a symbol that plainly has them. That is what a References tab restored after a
 * client reload used to show: its own tab came back, the file's editor tab did not mount,
 * so nothing mirrored the buffer and re-asking could never fix it.
 */

/**
 * Ceiling on a query-time disk load. A source file a user is querying is kilobytes; past
 * this it is a bundle or a data blob, and handing it to a language server is worse than
 * answering nothing.
 */
const MAX_LOADED_DOCUMENT_BYTES = 4 * 1024 * 1024;

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
   * needs back is the path *it* opened - those differ by drive-letter case, by `/` vs `\`,
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
   * entry point for a query - it is what makes a lazily-spawned server usable.
   */
  async serversFor(rootPath: string, filePath: string): Promise<BoundServer[]> {
    const bound = await this.pool.serversForDocument(rootPath, filePath);
    const document =
      this.documents.get(documentKey(filePath)) ?? (await this.loadFromDisk(rootPath, filePath));

    if (document === null) {
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

  /**
   * Mirror a file nobody has opened, so a query about it can be answered.
   *
   * Registered in the same map as an editor-mirrored document rather than opened and
   * dropped: a results tab re-asks (the provisional-while-indexing poll does so several
   * times), and paying a full `didOpen` per ask would be worse than holding kilobytes.
   * When an editor tab does mount later, its first `sync` sees identical text and is a
   * no-op; a differing draft bumps the version and sends `didChange`, exactly as if the
   * tab had mirrored it from the start.
   *
   * Best-effort by design. A file that is gone, unreadable, or oversized simply leaves the
   * servers unopened - the same state as before, which the caller already handles.
   */
  private async loadFromDisk(rootPath: string, filePath: string): Promise<OpenDocument | null> {
    try {
      const info = await stat(filePath);
      if (!info.isFile() || info.size > MAX_LOADED_DOCUMENT_BYTES) {
        return null;
      }
      const text = await readFile(filePath, "utf8");
      const document: OpenDocument = {
        rootPath,
        filePath,
        uri: toFileUri(filePath),
        languageId: languageIdForPath(filePath),
        version: 1,
        text,
        openedIn: new Map(),
      };
      this.documents.set(documentKey(filePath), document);
      return document;
    } catch (error) {
      this.logger.debug({ err: error, filePath }, "could not load a queried document from disk");
      return null;
    }
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
