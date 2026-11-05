import type { WorkspaceRegistry } from "../../workspace-registry.js";
import type { EditorHost } from "./service.js";
import { pathKey } from "./lsp/uri.js";

/** A checkout can be referenced by several workspace records. Archiving one
 * must not stop language servers still used by another active record. */
export async function releaseArchivedEditorWorkspace(
  editor: EditorHost,
  registry: WorkspaceRegistry,
  workspaceId: string,
) {
  const archived = await registry.get(workspaceId);
  if (!archived) return;
  const workspaces = await registry.list();
  const stillUsed = workspaces.some(
    (record) =>
      record.workspaceId !== workspaceId &&
      !record.archivedAt &&
      pathKey(record.cwd) === pathKey(archived.cwd),
  );
  if (!stillUsed) await editor.releaseWorkspace(archived.cwd);
}
