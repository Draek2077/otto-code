import { useMemo } from "react";
import type { z } from "zod";
import type { PluginRpcContract } from "@getpaseo/plugin";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { flushEditorDraftGuards } from "./draft-guard";
import {
  planEditorRename,
  planEditorReplace,
  applyEditorRename,
  undoEditorRename,
} from "@getpaseo/plugin/otto/editor";
const reviewedWrites = new Set([
  planEditorRename.name,
  planEditorReplace.name,
  applyEditorRename.name,
  undoEditorRename.name,
]);

export class EditorClient {
  constructor(
    readonly hostId: string,
    readonly daemon: DaemonClient,
  ) {}
  async call<Input extends z.ZodType, Output extends z.ZodType>(
    contract: PluginRpcContract<Input, Output>,
    input: z.input<Input>,
  ): Promise<z.output<Output>> {
    const validated = contract.input.parse(input);
    if (reviewedWrites.has(contract.name)) await flushEditorDraftGuards(this.hostId);
    const result = await this.daemon.invokePluginRpc("otto-editor", contract.name, validated);
    return contract.output.parse(result);
  }
}
export type EditorRpc = Pick<EditorClient, "hostId" | "call">;
export function useEditorConnection(serverId: string) {
  const daemon = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  // COMPAT(ottoEditor): added v0.10.0, remove gate after 2027-05-04 when the host floor >= v0.10.0.
  const supported = useHostFeature(serverId, "ottoEditor");
  const client = useMemo(
    () => (supported && connected && daemon ? new EditorClient(serverId, daemon) : null),
    [supported, connected, daemon, serverId],
  );
  if (!connected) return { state: "disconnected", client: null } as const;
  if (!client) return { state: "update", client: null } as const;
  return { state: "ready", client } as const;
}
