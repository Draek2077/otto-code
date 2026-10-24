/** Borrow the selected daemon/Brain owner for the shared standalone command handlers. */
import { z } from "zod";
import { BrainBootstrapSchema, BrainStatusSchema } from "@getpaseo/protocol/otto/brain";
import { encodeBrainCommandRequest, type HostCommandPort } from "@getpaseo/brain/cli-target";
import { BrainCliError, decodeBrainEnvelope } from "./rpc.js";
import { BrainOwnerRpc, type BrainRpcClient } from "./owner-rpc.js";

export async function openBrainCommandHost(client: BrainRpcClient): Promise<HostCommandPort> {
  // COMPAT(ottoBrainCommands): added in v0.10.0; remove after 2027-04-24 when floor >= v0.10.0.
  if (client.getLastServerInfoMessage()?.features?.ottoBrainCommands !== true)
    throw new BrainCliError(
      "DAEMON_UPDATE_REQUIRED",
      "Update the host to use the complete Brain commands.",
    );
  let bootstrap = BrainBootstrapSchema.parse(
    decodeBrainEnvelope(await client.invokePluginRpc("otto-brain", "brain.bootstrap", {})),
  );
  if (!bootstrap.connection.config.enabled)
    throw new BrainCliError(
      "BRAIN_DISABLED",
      "Enable Brain in the selected Otto host before running its model commands.",
    );
  const rpc = new BrainOwnerRpc(client, bootstrap.connection.revision);
  if (bootstrap.connection.config.mode === "local" && !bootstrap.localRunning) {
    // This existing owner admission starts only an unloaded management service.
    // It does not apply autostart or load a saved default model.
    await rpc.invoke(
      "brain.tui.start",
      { connectionRevision: rpc.connectionRevision },
      z.object({ accepted: z.literal(true) }),
    );
    bootstrap = await rpc.invoke("brain.bootstrap", {}, BrainBootstrapSchema);
    if (bootstrap.connection.revision !== rpc.connectionRevision)
      throw new BrainCliError(
        "BRAIN_CONFLICT",
        "The Brain connection changed. Reopen the command on its intended owner.",
      );
  }
  const status = await rpc.invoke("brain.query", { resource: "status" }, BrainStatusSchema);
  return {
    instanceId: status.instanceId,
    request: (route, signal, body) =>
      rpc.command(encodeBrainCommandRequest(route, body), status.instanceId, signal),
    events: (receive, signal) => rpc.events(receive, signal),
  };
}
