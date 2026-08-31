import { join } from "node:path";
import type { FileBackedWorkspaceRegistry } from "../workspace-registry.js";
import { WorkspaceLabelCatalogStore } from "./internal/catalog-store.js";
import { WorkspaceLabelService } from "./internal/service.js";
import type { WorkspaceLabelDefinition } from "@otto-code/protocol/workspace-labels";
import { WorkspaceLabelSequence } from "./internal/sequence.js";

export { WorkspaceLabelError, WorkspaceLabelService } from "./internal/service.js";
export { WorkspaceLabelStorageUncertainError } from "./internal/catalog-store.js";

export function createWorkspaceLabelService(input: {
  ottoHome: string;
  workspaceRegistry: FileBackedWorkspaceRegistry;
  writeCatalog?: (filePath: string, labels: readonly WorkspaceLabelDefinition[]) => Promise<void>;
  writeTransaction?: (filePath: string, transaction: unknown) => Promise<void>;
  removeTransaction?: (filePath: string) => Promise<void>;
  journalLimit?: number;
}): WorkspaceLabelService {
  return new WorkspaceLabelService(
    new WorkspaceLabelCatalogStore(
      join(input.ottoHome, "projects", "workspace-labels.json"),
      join(input.ottoHome, "projects", "workspace-labels.transaction.json"),
      input.workspaceRegistry,
      input.writeCatalog,
      input.writeTransaction,
      input.removeTransaction,
    ),
    new WorkspaceLabelSequence(input.journalLimit),
  );
}
