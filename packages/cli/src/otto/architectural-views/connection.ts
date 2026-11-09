import { writeFile } from "node:fs/promises";
import { z } from "zod";
import type { PluginRpcContract } from "@getpaseo/plugin";
import * as rpc from "@getpaseo/plugin/otto/architectural-views";
import { connectToDaemon } from "../../utils/client.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";
export interface ViewCliClient {
  getLastServerInfoMessage(): {
    serverId: string;
    features?: { ottoArchitecturalViews?: boolean };
  } | null;
  invokePluginRpc(pluginId: string, method: string, input: unknown): Promise<unknown>;
  close(): Promise<void>;
}
export interface ViewCliRequest {
  contract: PluginRpcContract;
  input: unknown;
  outputFile?: string;
}
const envelope = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), error: rpc.ViewError }),
]);
function operationIdentity(input: unknown): string {
  const result = z
    .object({
      operationId: z.string().optional(),
      draftId: z.string().optional(),
      viewId: z.string().optional(),
    })
    .safeParse(input);
  return result.success ? JSON.stringify(result.data) : "{}";
}
async function invoke(client: ViewCliClient, request: ViewCliRequest): Promise<unknown> {
  const input = request.contract.input.parse(request.input);
  const result = envelope.parse(
    request.contract.output.parse(
      await client.invokePluginRpc("otto-architectural-views", request.contract.name, input),
    ),
  );
  if (!result.ok)
    throw new Error(
      `${result.error.message}\nInspect before another write: ${operationIdentity(input)}`,
    );
  return result.value;
}
async function download(
  client: ViewCliClient,
  request: ViewCliRequest,
  value: unknown,
): Promise<void> {
  const input = rpc.renderView.input.parse(request.input),
    descriptor = rpc.ViewContent.parse(value);
  if (descriptor.revision !== input.expectedRevision)
    throw new Error("View export changed revision");
  const chunks: string[] = [];
  let characters = 0;
  for (let part = 0; part < descriptor.parts; part++) {
    const output = rpc.readViewContentPart.output.parse(
      await client.invokePluginRpc("otto-architectural-views", rpc.readViewContentPart.name, {
        scope: input.scope,
        identity: input.identity,
        selection: input.selection,
        contentId: descriptor.contentId,
        part,
      }),
    );
    if (!output.ok) throw new Error(output.error.message);
    if (output.value.contentId !== descriptor.contentId || output.value.part !== part)
      throw new Error("View export part identity changed");
    characters += output.value.text.length;
    if (characters > descriptor.characters)
      throw new Error("View export exceeded its transfer budget");
    chunks.push(output.value.text);
  }
  if (characters !== descriptor.characters) throw new Error("View export was incomplete");
  await writeFile(request.outputFile!, chunks.join(""), { flag: "wx", mode: 0o600 });
}
export async function runViewRequest(
  target: DaemonTarget,
  build: (hostId: string) => Promise<ViewCliRequest>,
  connect: (target: DaemonTarget) => Promise<ViewCliClient> = (selected) =>
    connectToDaemon({ target: selected }),
): Promise<unknown> {
  const client = await connect(target);
  try {
    const info = client.getLastServerInfoMessage();
    // COMPAT(ottoArchitecturalViewsCli): added v0.10.0; remove after 2027-05-09 when host floor >= v0.10.0.
    if (!info?.features?.ottoArchitecturalViews)
      throw new Error("Update the selected host to use Architectural Views.");
    const request = await build(info.serverId);
    const value = await invoke(client, request);
    if (request.outputFile) await download(client, request, value);
    return value;
  } finally {
    await client.close().catch(() => undefined);
  }
}
