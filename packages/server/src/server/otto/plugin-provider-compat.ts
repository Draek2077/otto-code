import path from "node:path";
import type { ProviderPersistence, ProviderRegistration } from "@getpaseo/plugin/server/provider";
import type { AgentPersistenceHandle } from "../agent/agent-sdk-types.js";
import { z } from "zod";

export interface OttoProviderContext {
  home: string;
  provider: string;
}
const contexts = new WeakMap<ProviderRegistration, OttoProviderContext>();

/** Mark registrations at the trusted built-in boundary, never by a client-supplied provider ID. */
export function ottoProviderRegistration(input: {
  registration: ProviderRegistration;
  pluginId: string;
  settingsDirectory?: string;
}): ProviderRegistration {
  if (
    (input.pluginId === "otto-openai-compatible-provider" || input.pluginId === "otto-brain") &&
    input.settingsDirectory &&
    path.isAbsolute(input.settingsDirectory) &&
    path.basename(input.settingsDirectory) === "plugin-settings"
  )
    contexts.set(input.registration, {
      home: path.dirname(input.settingsDirectory),
      provider: input.registration.id,
    });
  return input.registration;
}
export function ottoProviderContext(
  registration: ProviderRegistration,
): OttoProviderContext | undefined {
  return contexts.get(registration);
}

/** COMPAT(otto09ProviderHistory): v0.10.0, review after 2027-04-22.
 * Only our built-in may receive an old native handle; its backend verifies the saved
 * endpoint and retains an original copy before importing supported history.
 */
export function ottoLegacyPersistence(input: {
  context?: OttoProviderContext;
  handle: AgentPersistenceHandle;
}): ProviderPersistence | null {
  const { context, handle } = input;
  if (
    !context ||
    context.provider !== handle.provider ||
    handle.sessionId.startsWith("plugin:") ||
    handle.metadata?.pluginProviderPersistence !== undefined
  )
    return null;
  return {
    version: 1,
    data: { format: "otto-openai-0.9-handle-v1", handle: z.json().parse(handle) },
  };
}
