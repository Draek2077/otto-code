import { pathKey } from "./lsp/uri.js";
import { EditorError } from "./errors.js";
interface Guard {
  clientId: string;
  root: string;
  file: string;
  modified: boolean;
  revision: number;
}
/** Metadata only. It neither stores draft text nor holds an LSP/document lease. */
export class EditorDraftGuards {
  private readonly guards = new Map<string, Guard>();
  update(clientId: string, documentId: string, value: Omit<Guard, "clientId">) {
    const key = JSON.stringify([clientId, documentId]),
      previous = this.guards.get(key);
    if (previous && value.revision < previous.revision) return previous.modified;
    if (!previous && this.guards.size >= 512)
      throw new EditorError(
        "unavailable",
        "Too many editor draft guards are retained. Close an editor tab.",
      );
    if (value.modified) this.guards.set(key, { clientId, ...value });
    else this.guards.delete(key);
    return value.modified;
  }
  blocked(root: string, file: string) {
    return [...this.guards.values()].some(
      (guard) =>
        guard.modified &&
        pathKey(guard.root) === pathKey(root) &&
        pathKey(guard.file) === pathKey(file),
    );
  }
  releaseClient(clientId: string) {
    for (const [key, value] of this.guards)
      if (value.clientId === clientId) this.guards.delete(key);
  }
  releaseWorkspace(root: string) {
    for (const [key, value] of this.guards)
      if (pathKey(value.root) === pathKey(root)) this.guards.delete(key);
  }
  clear() {
    this.guards.clear();
  }
}
