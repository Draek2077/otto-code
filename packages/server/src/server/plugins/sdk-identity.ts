import type { OttoApi } from "@otto-code/client";
import type { PluginSdkNamespace } from "@otto-code/plugin";
import * as providerRuntime from "@otto-code/plugin/server/provider";
import * as acpRuntime from "@otto-code/plugin/server/acp";
import { z } from "zod";

/** Author aliases share a single connection and the same API object. */
export function pluginApiContext(otto: OttoApi) {
  return { otto, paseo: otto };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const attachmentKinds = {
  forge_change_request: "forge-change-request",
  forge_issue: "forge-issue",
  review: "review",
} as const;

/** Only provider attachment discriminants are translated; prompt text and opaque data stay intact. */
export function projectProviderInput(value: unknown, namespace: PluginSdkNamespace): unknown {
  if (!record(value) || value.type !== "session.prompt" || !record(value.prompt)) return value;
  const input = value.prompt.input;
  if (!record(input) || input.type !== "message" || !Array.isArray(input.content)) return value;
  let changed = false;
  const content = input.content.map((item: unknown) => {
    if (
      !record(item) ||
      typeof item.type !== "string" ||
      !Object.hasOwn(attachmentKinds, item.type)
    )
      return item;
    const suffix = attachmentKinds[item.type as keyof typeof attachmentKinds];
    const source = `application/${namespace === "otto" ? "paseo" : "otto"}-${suffix}`;
    if (item.mimeType !== source) return item;
    changed = true;
    return { ...item, mimeType: `application/${namespace}-${suffix}` };
  });
  return changed ? { ...value, prompt: { ...value.prompt, input: { ...input, content } } } : value;
}

export const upstreamProviderRuntime = {
  ...providerRuntime,
  ProviderInputSchema: z
    .preprocess((input) => projectProviderInput(input, "otto"), providerRuntime.ProviderInputSchema)
    .transform((input) => projectProviderInput(input, "paseo")),
};

/** The host ACP adapter owns Otto canonical inputs even when imported through the upstream alias. */
export const upstreamAcpRuntime = {
  ...acpRuntime,
  runAcpProvider(options: Parameters<typeof acpRuntime.runAcpProvider>[0]) {
    const provider = acpRuntime.runAcpProvider(options);
    return {
      ...provider,
      getCatalogCacheKey: provider.getCatalogCacheKey?.bind(provider),
      async connect(request: Parameters<typeof provider.connect>[0]) {
        const connection = await provider.connect(request);
        return {
          ...connection,
          send: (input: providerRuntime.ProviderInput) =>
            connection.send(
              providerRuntime.ProviderInputSchema.parse(projectProviderInput(input, "otto")),
            ),
          onEvent: connection.onEvent.bind(connection),
          close: connection.close.bind(connection),
        };
      },
    };
  },
};
