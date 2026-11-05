import { EditorError } from "./errors.js";
import { pathKey } from "./lsp/uri.js";
interface Operation {
  clientId: string;
  root: string;
  active: boolean;
}
/** In-flight admission authority, not another document store. A release makes
 * callbacks already awaiting filesystem/queue work unable to start children. */
export class EditorOperations {
  private readonly operations = new Set<Operation>();
  private closed = false;
  async run<T>(
    clientId: string,
    root: string,
    work: (isCurrent: () => boolean) => Promise<T>,
  ): Promise<T> {
    if (this.closed) throw new EditorError("closed", "Editor operations are shutting down.");
    if (this.operations.size >= 128)
      throw new EditorError("unavailable", "Too many editor operations are pending.");
    const operation = { clientId, root: pathKey(root), active: true };
    this.operations.add(operation);
    try {
      const result = await work(() => operation.active && !this.closed);
      if (!operation.active || this.closed)
        throw new EditorError("closed", "Editor demand was released.");
      return result;
    } finally {
      this.operations.delete(operation);
    }
  }
  releaseClient(clientId: string) {
    for (const operation of this.operations)
      if (operation.clientId === clientId) operation.active = false;
  }
  releaseWorkspace(root: string) {
    for (const operation of this.operations)
      if (operation.root === pathKey(root)) operation.active = false;
  }
  close() {
    this.closed = true;
    for (const operation of this.operations) operation.active = false;
  }
}
