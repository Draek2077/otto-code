import { createHash } from "node:crypto";

export function connectorToolName(connectorId: string, toolName: string): string {
  const suffix = createHash("sha256")
    .update(JSON.stringify([connectorId, toolName]))
    .digest("hex")
    .slice(0, 12);
  return (
    `connector_${connectorId}_${toolName}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 51) +
    "_" +
    suffix
  );
}
