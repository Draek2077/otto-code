import { randomUUID } from "node:crypto";
import type { EditorDocument, EditorObservation } from "@getpaseo/plugin/otto/editor";
import { EditorError } from "./errors.js";
import { pathKey, uriPath } from "./lsp/uri.js";
import type { PublishedDiagnostics } from "./lsp/schema.js";

interface Lease {
  clientId: string;
  documentId: string;
  root: string;
  file: string;
  text: string;
  draftVersion: number;
  modified: boolean;
  diagnostics: Map<string, EditorObservation["diagnostics"]>;
  cursor: string;
  timer: ReturnType<typeof setTimeout>;
  wake: (() => void) | null;
}
interface DocumentLeasesOptions {
  closeDocument(root: string, file: string): Promise<void>;
  onError(error: unknown): void;
}

/** Authenticated-session leases retain only active editors, with one bounded
 * long wait per document. Hidden/disconnected editors release their demand. */
export class EditorDocuments {
  private readonly leases = new Map<string, Lease>();
  constructor(private readonly options: DocumentLeasesOptions) {}
  rootFor(clientId: string, documentId: string): string {
    const lease = this.leases.get(this.key(clientId, documentId));
    if (!lease) throw new EditorError("closed", "Editor document is no longer observed.");
    return lease.root;
  }
  drafts(root: string, file: string): readonly string[] {
    return [...this.leases.values()]
      .filter(
        (lease) =>
          lease.modified &&
          pathKey(lease.root) === pathKey(root) &&
          pathKey(lease.file) === pathKey(file),
      )
      .map((lease) => lease.text);
  }
  private key(clientId: string, documentId: string) {
    return JSON.stringify([clientId, documentId]);
  }
  bound(
    clientId: string,
    hostId: string,
    documentId: string,
    draftVersion: number,
    modified: boolean,
  ): EditorDocument | null {
    const key = this.key(clientId, documentId);
    const lease = this.leases.get(key);
    if (!lease || lease.draftVersion !== draftVersion) return null;
    lease.modified = modified;
    this.renew(key, lease);
    return {
      hostId,
      documentId,
      root: lease.root,
      file: lease.file,
      text: lease.text,
      draftVersion,
      modified,
    };
  }
  sync(clientId: string, input: EditorDocument) {
    if (!clientId)
      throw new EditorError("invalid", "Editor demand requires an authenticated session.");
    const key = this.key(clientId, input.documentId);
    const previous = this.leases.get(key);
    const retainedCharacters =
      [...this.leases.values()].reduce((count, lease) => count + lease.text.length, 0) -
      (previous?.text.length ?? 0) +
      input.text.length;
    if (retainedCharacters > 16 * 1024 * 1024)
      throw new EditorError(
        "unavailable",
        "The host's active editor draft budget is full. Close an inactive editor first.",
      );
    if (previous) {
      if (
        pathKey(previous.file) !== pathKey(input.file) ||
        pathKey(previous.root) !== pathKey(input.root)
      )
        throw new EditorError(
          "invalid",
          "An editor document identity cannot be reused for another file.",
        );
      if (input.draftVersion < previous.draftVersion)
        throw new EditorError("conflict", "Editor request belongs to an older draft.");
      if (input.draftVersion === previous.draftVersion && input.text !== previous.text)
        throw new EditorError(
          "conflict",
          "An editor draft revision cannot identify two different contents.",
        );
      const changed = previous.text !== input.text || previous.draftVersion !== input.draftVersion;
      previous.text = input.text;
      previous.draftVersion = input.draftVersion;
      previous.modified = input.modified;
      this.renew(key, previous);
      if (changed) {
        previous.diagnostics.clear();
        this.changed(previous);
      }
      return;
    }
    const clientCount = [...this.leases.values()].filter(
      (lease) => lease.clientId === clientId,
    ).length;
    if (this.leases.size >= 128 || clientCount >= 32)
      throw new EditorError("unavailable", "Too many active editor documents.");
    const lease: Lease = {
      clientId,
      documentId: input.documentId,
      root: input.root,
      file: input.file,
      text: input.text,
      draftVersion: input.draftVersion,
      modified: input.modified,
      diagnostics: new Map(),
      cursor: randomUUID(),
      timer: this.expiry(key),
      wake: null,
    };
    this.leases.set(key, lease);
  }
  publish(root: string, serverId: string, published: PublishedDiagnostics, text: string) {
    const file = uriPath(published.uri);
    for (const lease of this.leases.values()) {
      const sameDocument =
        pathKey(lease.root) === pathKey(root) && pathKey(lease.file) === pathKey(file);
      if (!sameDocument || lease.text !== text) continue;
      const diagnostics = published.diagnostics.map((item) => ({
        range: item.range,
        severity: item.severity ?? 1,
        message: item.message,
        source: item.source ?? serverId,
        code: item.code === undefined ? null : String(item.code),
      }));
      lease.diagnostics.set(serverId, diagnostics);
      this.changed(lease);
    }
  }
  serverGone(root: string, serverId: string) {
    for (const lease of this.leases.values()) {
      if (pathKey(lease.root) === pathKey(root) && lease.diagnostics.delete(serverId))
        this.changed(lease);
    }
  }
  private changed(lease: Lease) {
    lease.cursor = randomUUID();
    lease.wake?.();
  }
  private expiry(key: string) {
    const timer = setTimeout(() => {
      void this.release(key).catch(this.options.onError);
    }, 30000);
    timer.unref();
    return timer;
  }
  private renew(key: string, lease: Lease) {
    clearTimeout(lease.timer);
    lease.timer = this.expiry(key);
  }
  async observe(
    clientId: string,
    documentId: string,
    cursor: string | null,
    servers: () => EditorObservation["servers"],
  ): Promise<EditorObservation> {
    const key = this.key(clientId, documentId);
    const lease = this.leases.get(key);
    if (!lease) throw new EditorError("closed", "Editor document is no longer observed.");
    if (lease.wake) throw new EditorError("invalid", "An editor observation is already waiting.");
    this.renew(key, lease);
    if (cursor === lease.cursor)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 20000);
        timer.unref();
        lease.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      }).finally(() => {
        lease.wake = null;
      });
    if (this.leases.get(key) !== lease)
      throw new EditorError("closed", "Editor document was released.");
    return {
      cursor: lease.cursor,
      draftVersion: lease.draftVersion,
      diagnostics: [...lease.diagnostics.values()].flat().slice(0, 10000),
      servers: servers(),
    };
  }
  async releaseClient(clientId: string) {
    for (const [key, lease] of this.leases)
      if (lease.clientId === clientId) await this.release(key);
  }
  async releaseWorkspace(root: string) {
    for (const [key, lease] of this.leases)
      if (pathKey(lease.root) === pathKey(root)) await this.release(key);
  }
  releaseDocument(clientId: string, documentId: string) {
    return this.release(this.key(clientId, documentId));
  }
  private async release(key: string) {
    const lease = this.leases.get(key);
    if (!lease) return;
    this.leases.delete(key);
    clearTimeout(lease.timer);
    lease.wake?.();
    const stillOpen = [...this.leases.values()].some(
      (other) =>
        pathKey(other.root) === pathKey(lease.root) && pathKey(other.file) === pathKey(lease.file),
    );
    if (!stillOpen) await this.options.closeDocument(lease.root, lease.file);
  }
  async close() {
    for (const key of this.leases.keys()) await this.release(key);
  }
}
