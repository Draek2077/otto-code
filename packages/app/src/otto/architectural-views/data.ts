import { useMemo } from "react";
import type { PluginRpcContract } from "@getpaseo/plugin";
import type { z } from "zod";
import * as rpc from "@getpaseo/plugin/otto/architectural-views";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useFetchQuery } from "@/data/query";

import { ViewRequestError } from "./errors";
export function unwrapView<T>(
  result: { ok: true; value: T } | { ok: false; error: z.infer<typeof rpc.ViewError> },
): T {
  if (!result.ok) throw new ViewRequestError(result.error.code, result.error.message);
  return result.value;
}
export interface ViewClient {
  call<I extends z.ZodType, O extends z.ZodType>(
    contract: PluginRpcContract<I, O>,
    input: z.input<I>,
  ): Promise<z.output<O>>;
}
/** Usable from Knowledge and ordinary chats without constructing another plugin/provider context. */
export function useViewClient(hostId: string): ViewClient {
  const client = useHostRuntimeClient(hostId);
  return useMemo(
    () => ({
      call<I extends z.ZodType, O extends z.ZodType>(
        contract: PluginRpcContract<I, O>,
        input: z.input<I>,
      ) {
        if (!client)
          return Promise.reject(
            new ViewRequestError("unavailable", "The owning View host is disconnected."),
          );
        const parsed = contract.input.parse(input);
        return client
          .invokePluginRpc("otto-architectural-views", contract.name, parsed)
          .then((value) => contract.output.parse(value));
      },
    }),
    [client],
  );
}
export function useViewLibrary(
  scope: rpc.ViewScope,
  active: boolean,
  reference?: rpc.ViewReference,
  offset = 0,
  query = "",
) {
  const client = useViewClient(scope.hostId);
  return useFetchQuery({
    dataShape: "value",
    staleTimeMs: 2000,
    queryKey: [
      "ottoViews",
      scope.hostId,
      scope.target.kind,
      scope.target.id,
      "catalog",
      reference,
      offset,
      query,
    ],
    enabled: active,
    retry: false,
    queryFn: async () =>
      unwrapView(await client.call(rpc.readViews, { scope, reference, offset, query })),
  });
}
export function useViewDocument(
  scope: rpc.ViewScope,
  identity: rpc.ViewIdentity,
  selection: rpc.ViewSelection,
  active: boolean,
) {
  const client = useViewClient(scope.hostId);
  return useFetchQuery({
    dataShape: "value",
    staleTimeMs: 2000,
    queryKey: [
      "ottoViews",
      scope.hostId,
      scope.target.kind,
      scope.target.id,
      "document",
      identity,
      selection,
    ],
    enabled: active,
    retry: false,
    queryFn: async () =>
      unwrapView(await client.call(rpc.readView, { scope, identity, selection })),
  });
}
export async function transferView(
  client: ViewClient,
  input: z.input<typeof rpc.renderView.input>,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) throw new Error("View transfer canceled");
  const descriptor = unwrapView(await client.call(rpc.renderView, input));
  if (descriptor.revision !== input.expectedRevision)
    throw new Error("View content revision changed");
  const chunks: string[] = [];
  let characters = 0;
  for (let part = 0; part < descriptor.parts; part++) {
    if (signal.aborted) throw new Error("View transfer canceled");
    const chunk = unwrapView(
      await client.call(rpc.readViewContentPart, {
        scope: input.scope,
        identity: input.identity,
        selection: input.selection,
        contentId: descriptor.contentId,
        part,
      }),
    );
    if (chunk.contentId !== descriptor.contentId || chunk.part !== part)
      throw new Error("View content part identity changed");
    characters += chunk.text.length;
    if (characters > descriptor.characters)
      throw new Error("View content exceeded its declared budget");
    chunks.push(chunk.text);
  }
  if (signal.aborted || characters !== descriptor.characters)
    throw new Error("View transfer did not complete");
  return chunks.join("");
}
export function useViewContent(
  scope: rpc.ViewScope,
  identity: rpc.ViewIdentity,
  selection: rpc.ViewSelection,
  revision: string,
  active: boolean,
) {
  const client = useViewClient(scope.hostId);
  return useFetchQuery({
    dataShape: "value",
    staleTimeMs: 300000,
    gcTime: 60000,
    queryKey: [
      "ottoViews",
      scope.hostId,
      scope.target.kind,
      scope.target.id,
      "content",
      identity,
      selection,
      revision,
    ],
    enabled: active,
    retry: false,
    queryFn: ({ signal }) =>
      transferView(client, { scope, identity, selection, expectedRevision: revision }, signal),
  });
}
