import type { DaemonTarget } from "../../utils/daemon-target.js";
export interface WorkflowCliClient {
  getLastServerInfoMessage(): { serverId: string; features?: { ottoWorkflows?: boolean } } | null;
  invokePluginRpc(id: string, method: string, input: unknown): Promise<unknown>;
  close(): Promise<void>;
}
export type WorkflowCliConnect = (target: DaemonTarget) => Promise<WorkflowCliClient>;
export function workflowCliHostId(client: WorkflowCliClient) {
  const info = client.getLastServerInfoMessage();
  // COMPAT(ottoWorkflowsCli): added v0.10.0; remove after 2027-05-05 when host floor >= v0.10.0.
  if (!info?.features?.ottoWorkflows) throw new Error("Update the selected host to use Workflows.");
  return info.serverId;
}
